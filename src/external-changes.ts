import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createVaultBackup } from './backup'
import { deploymentAgent, deploymentRoot, hasErrorCode, validateVault, type SkillAgent, type VaultData } from './model'
import { assertImportedOriginsPreserved } from './skill-deletion'
import { skillPublicationMarkdown } from './project-skills'
import { readVault, saveVaultData } from './vault'

const hash = (content: string) => createHash('sha256').update(content).digest('hex')
export interface SkillVersion {
  path: string
  root: string
  content: string | null
  projectId?: string
  agent?: SkillAgent
  directory?: string
  changed: boolean
  error?: string
}
export interface ExternalSkillChange {
  skillId: string
  name: string
  revision: string
  library: SkillVersion
  publications: SkillVersion[]
}

async function safeFile(root: string, path: string, createParents = false): Promise<string | null> {
  const canonical = await fs.realpath(root)
  const parts = relative(canonical, path).split(sep)
  if (isAbsolute(relative(canonical, path)) || parts.includes('..') || !parts[0]) {
    throw new Error(`Caminho fora da pasta gerenciada: ${path}`)
  }
  let current = canonical
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const last = index === parts.length - 1
    try {
      if (!last && createParents) await fs.mkdir(current).catch(error => {
        if (!hasErrorCode(error, 'EEXIST')) throw error
      })
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || (last ? !stat.isFile() || stat.size > 2 * 1024 * 1024 : !stat.isDirectory())) {
        throw new Error(`Arquivo ou diretorio invalido, simbolico ou maior que 2 MB: ${current}`)
      }
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null
      throw error
    }
  }
  return fs.readFile(current, 'utf8')
}

export async function inspectSkillVersions(root: string, data: VaultData, skillId: string): Promise<ExternalSkillChange> {
  const skill = data.catalog.skills.find(item => item.id === skillId)
  if (!skill) throw new Error('Skill nao encontrada.')
  const canonical = await fs.realpath(root)
  const library: SkillVersion = {
    root: canonical, path: join(canonical, skill.filePath), changed: false,
    content: await safeFile(canonical, join(canonical, skill.filePath))
  }
  const publications: SkillVersion[] = []
  for (const project of data.projects.projects) {
    for (const deployed of project.deployedSkills?.filter(item => item.skillId === skillId) ?? []) {
      if (!project.sourcePath) throw new Error(`Projeto sem pasta: ${project.name}`)
      let projectRoot: string
      try {
        projectRoot = await fs.realpath(project.sourcePath)
      } catch (error) {
        if (!hasErrorCode(error, 'ENOENT')) throw error
        projectRoot = resolve(project.sourcePath)
        publications.push({
          root: projectRoot, path: join(projectRoot, deploymentRoot(deployed), 'skills', deployed.directory, 'SKILL.md'),
          content: null, projectId: project.id, agent: deploymentAgent(deployed), directory: deployed.directory,
          changed: true, error: `Pasta de projeto indisponivel: ${projectRoot}`
        })
        continue
      }
      const path = join(projectRoot, deploymentRoot(deployed), 'skills', deployed.directory, 'SKILL.md')
      const content = await safeFile(projectRoot, path)
      if (library.content === null) library.changed = true
      else {
        try {
          if (hash(skillPublicationMarkdown(skill, deployed.directory, library.content).toString('utf8')) !== deployed.sourceHash) {
            library.changed = true
          }
        } catch (error) {
          library.changed = true
          library.error = error instanceof Error ? error.message : String(error)
        }
      }
      publications.push({
        root: projectRoot, path, content, projectId: project.id, agent: deploymentAgent(deployed),
        directory: deployed.directory, changed: content === null || hash(content) !== deployed.hash
      })
    }
  }
  if (library.content === null) library.changed = true
  return { skillId, name: skill.name, revision: hash(JSON.stringify(validateVault(data.catalog, data.projects))), library, publications }
}

export async function detectExternalChanges(root: string, data: VaultData): Promise<ExternalSkillChange[]> {
  const changes: ExternalSkillChange[] = []
  for (const skill of data.catalog.skills) {
    const change = await inspectSkillVersions(root, data, skill.id)
    if (change.library.changed || change.publications.some(item => item.changed)) changes.push(change)
  }
  return changes
}

async function replace(version: SkillVersion, content: string): Promise<void> {
  await safeFile(version.root, version.path, true)
  const temporary = join(dirname(version.path), `.skillvortex-sync-${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' })
    await fs.rename(temporary, version.path)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export async function resolveExternalChange(
  root: string, approved: ExternalSkillChange, sourcePath: string,
  save: (root: string, data: VaultData) => Promise<void> = saveVaultData
): Promise<string> {
  const data = await readVault(root)
  const previousMetadata = JSON.stringify(data)
  const current = await inspectSkillVersions(root, data, approved.skillId)
  current.library.changed = approved.library.changed
  if (JSON.stringify(current) !== JSON.stringify(approved)) {
    throw new Error('Os arquivos mudaram apos a revisao. Compare novamente antes de sincronizar.')
  }
  const versions = [current.library, ...current.publications]
  const unavailable = current.publications.find(version => version.error)
  if (unavailable) throw new Error(unavailable.error)
  const canonicalSource = await fs.realpath(sourcePath)
  const source = versions.find(item => item.path === canonicalSource)
  if (!source || source.content === null) throw new Error('Escolha uma versao existente para sincronizar.')
  const skill = data.catalog.skills.find(item => item.id === current.skillId)
  if (!skill) throw new Error('Skill nao encontrada.')
  const chosenContent = source.content
  const writes = versions.map(version => {
    if (version !== current.library && !version.directory) throw new Error('Diretorio da publicacao ausente.')
    return {
      version,
      content: version.directory
        ? skillPublicationMarkdown(skill, version.directory, chosenContent).toString('utf8') : chosenContent
    }
  }).filter(item => item.version.content !== item.content)
  if (writes.some(item => Buffer.byteLength(item.content) > 2 * 1024 * 1024)) {
    throw new Error('O Markdown publicado excede o limite de 2 MB.')
  }
  await assertImportedOriginsPreserved(data.catalog.skills, [], writes.map(item => item.version.path))
  let recovery: string
  if (current.library.content === null) {
    recovery = join(await fs.realpath(root), '.skillvortex', 'backups', `external-recovery-${randomUUID()}`, 'external-changes')
    await safeFile(await fs.realpath(root), join(recovery, 'manifest.json'), true)
    await fs.writeFile(join(recovery, 'metadata.json'), JSON.stringify(data, null, 2), { flag: 'wx' })
  } else {
    const backup = await createVaultBackup(root)
    recovery = join(await fs.realpath(root), '.skillvortex', 'backups', backup.id, 'external-changes')
    await fs.mkdir(recovery)
  }
  for (const [index, version] of versions.entries()) {
    if (version.content !== null) await fs.writeFile(join(recovery, `${index}.md`), version.content, { flag: 'wx' })
  }
  await fs.writeFile(join(recovery, 'manifest.json'), JSON.stringify(versions.map((version, index) => ({
    path: version.path, snapshot: version.content === null ? null : `${index}.md`
  })), null, 2), { flag: 'wx' })
  const checked = await inspectSkillVersions(root, await readVault(root), current.skillId)
  checked.library.changed = current.library.changed
  if (JSON.stringify(checked) !== JSON.stringify(current)) {
    throw new Error(`Arquivos mudaram durante o backup. Nada foi substituido. Backup: ${recovery}`)
  }
  const applied: Array<{ version: SkillVersion; content: string }> = []
  let saving = false
  try {
    for (const { version, content } of writes) {
      if (await safeFile(version.root, version.path) !== version.content) {
        throw new Error(`Arquivo mudou durante a sincronizacao: ${version.path}`)
      }
      await replace(version, content)
      applied.push({ version, content })
    }
    if (JSON.stringify(await readVault(root)) !== previousMetadata) {
      throw new Error('Os metadados mudaram durante a sincronizacao. Revise novamente.')
    }
    for (const version of current.publications) {
      const project = data.projects.projects.find(item => item.id === version.projectId)
      const deployed = project?.deployedSkills?.find(item =>
        item.skillId === skill.id && deploymentAgent(item) === version.agent)
      if (!deployed || !version.directory) throw new Error('Publicacao nao encontrada.')
      deployed.sourceHash = hash(skillPublicationMarkdown(skill, version.directory, source.content).toString('utf8'))
      deployed.hash = deployed.sourceHash
    }
    saving = true
    await save(root, data)
  } catch (error) {
    const errors: unknown[] = [error]
    if (saving && JSON.stringify(data) !== previousMetadata) {
      let persisted: VaultData
      try {
        persisted = await readVault(root)
      } catch (verificationError) {
        throw new AggregateError([error, verificationError],
          `Nao foi possivel concluir a verificacao dos metadados. Arquivos preservados; backup em ${recovery}.`)
      }
      if (JSON.stringify(persisted) === JSON.stringify(data)) {
        throw new AggregateError([error],
          `Arquivos e metadados sincronizados, mas a confirmacao falhou. Backup preservado em ${recovery}.`)
      }
    }
    for (const { version, content } of applied.reverse()) {
      try {
        if (await safeFile(version.root, version.path) !== content) throw new Error(`Arquivo mudou: ${version.path}`)
        if (version.content === null) await fs.unlink(version.path)
        else await replace(version, version.content)
      } catch (rollbackError) { errors.push(rollbackError) }
    }
    throw new AggregateError(errors, `Falha ao sincronizar. Versoes anteriores preservadas em ${recovery}. ${String(error)}`)
  }
  return recovery
}
