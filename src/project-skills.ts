import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { isMap, parseDocument } from 'yaml'
import {
  agentRoot, deploymentAgent, deploymentRoot, hasErrorCode, isAgentLinked,
  projectBindings, skillSlug, type Skill, type SkillAgent, type VaultData
} from './model'
import { assertImportedOriginsPreserved, skillArchiveName } from './skill-deletion'
import { readContained, saveVaultData } from './vault'

type Project = VaultData['projects']['projects'][number]
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex')

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`)
}

async function directory(root: string, parts: string[]): Promise<string> {
  let path = root
  for (const part of parts) {
    path = join(path, part)
    try {
      await fs.mkdir(path)
    } catch (error) {
      if (!hasErrorCode(error, 'EEXIST')) throw error
    }
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Diretorio de skills invalido ou simbolico: ${path}`)
    }
  }
  return path
}

async function readFile(path: string): Promise<Buffer | undefined> {
  try {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) {
      throw new Error(`Arquivo de skill invalido, simbolico ou maior que 2 MB: ${path}`)
    }
    return await fs.readFile(path)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
}

async function validMarker(path: string, skillId: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 800) return false
    return await fs.readFile(path, 'utf8') === skillId
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

async function isImportedOrigin(skill: Skill, path: string): Promise<boolean> {
  if (!skill.originPath) return false
  const origin = skill.originPath.startsWith('~/')
    ? join(homedir(), skill.originPath.slice(2)) : skill.originPath
  if (!isAbsolute(origin)) throw new Error(`Caminho de origem invalido: ${skill.originPath}`)
  try {
    return await fs.realpath(origin) === await fs.realpath(path)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

function skillDirectory(skill: Skill): string {
  return skillSlug(skill.name)
}

function isDirectoryVariant(base: string, candidate: string): boolean {
  if (candidate === base) return true
  const suffix = candidate.match(/-[0-9]+$/)?.[0]
  return Boolean(suffix && Number(suffix.slice(1)) >= 2 &&
    candidate === `${base.slice(0, 64 - suffix.length).replace(/-+$/g, '')}${suffix}`)
}

function rememberFolder(skill: Skill, folder: NonNullable<Skill['publishedFolders']>[number]): void {
  const folders = skill.publishedFolders ?? []
  const existing = folders.find(item => item.projectId === folder.projectId &&
    item.projectPath === folder.projectPath && item.directory === folder.directory &&
    deploymentRoot(item) === deploymentRoot(folder))
  if (existing) {
    existing.owned = existing.owned && folder.owned
    existing.marker = existing.owned ? folder.marker ?? existing.marker : undefined
  } else folders.push({ ...folder })
  skill.publishedFolders = folders
}

function archivedSkillDirectory(content: Buffer): string | undefined {
  const name = skillMarkdownMetadata(content.toString('utf8')).name
  return name && /^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ? name : undefined
}

export function skillMarkdownMetadata(content: string): { name?: string; description?: string } {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) {
    if (/^---\r?\n/.test(content)) throw new Error('Frontmatter YAML invalido: falta o delimitador de fechamento.')
    return {}
  }
  const document = parseDocument(frontmatter[1])
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error(`Frontmatter YAML invalido. ${document.errors.map(error => error.message).join(' ')}`)
  }
  const name = document.get('name')
  const description = document.get('description')
  if ((name !== undefined && (typeof name !== 'string' || !name.trim())) ||
      (description !== undefined && (typeof description !== 'string' || !description.trim()))) {
    throw new Error('Os campos name e description do frontmatter devem ser textos nao vazios.')
  }
  return { name: typeof name === 'string' ? name : undefined,
    description: typeof description === 'string' ? description : undefined }
}

function updateFrontmatter(content: Buffer, skill: Skill, name: string): Buffer {
  const text = content.toString('utf8')
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (!frontmatter) {
    throw new Error(`Frontmatter da skill invalido; nao foi possivel renomear: ${skill.name}`)
  }
  const document = parseDocument(frontmatter[0].replace(/^---\r?\n/, '').replace(/\r?\n---(?:\r?\n|$)$/, ''))
  if (document.errors.length || !isMap(document.contents)) {
    throw new Error(`Frontmatter YAML invalido: ${skill.name}. ${document.errors.map(error => error.message).join(' ')}`)
  }
  document.set('name', name)
  document.set('description', skill.description.trim())
  return Buffer.from(`---\n${document.toString()}---\n${text.slice(frontmatter[0].length)}`)
}

function markdownBody(content: Buffer): string {
  const text = content.toString('utf8')
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  return frontmatter ? text.slice(frontmatter[0].length) : text
}

function markdown(skill: Skill, name: string, content: string): Buffer {
  if (!skill.description.trim()) throw new Error(`Informe a descricao da skill ${skill.name}.`)
  skillMarkdownMetadata(content)
  const body = markdownBody(Buffer.from(content))
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (frontmatter) {
    return updateFrontmatter(Buffer.from(content), skill, name)
  }
  return Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(skill.description.trim())}\n---\n\n${body}`)
}

// Journal filesystem changes so a metadata failure cannot leave the switch out of sync.
export async function saveProjectSkills(
  root: string,
  previous: VaultData,
  next: VaultData,
  save: (root: string, data: VaultData) => Promise<void> = saveVaultData,
  agentScope?: SkillAgent
): Promise<void> {
  const canonicalRoot = await fs.realpath(root)
  const undo: Array<() => Promise<void>> = []
  const write = async (path: string, content: Buffer) => {
    if (content.length > 2 * 1024 * 1024) throw new Error(`Skill maior que 2 MB: ${path}`)
    const file = await fs.open(path, 'wx')
    undo.push(() => fs.unlink(path))
    try {
      await file.writeFile(content)
    } finally {
      await file.close()
    }
  }
  const remove = async (path: string, content: Buffer) => {
    await fs.unlink(path)
    undo.push(() => fs.writeFile(path, content, { flag: 'wx' }))
  }
  const archivedPath = async (project: Project, skillId: string, agent: SkillAgent) =>
    join(await directory(canonicalRoot, ['.skillvortex', 'disabled-skills', hash(project.id)]),
      skillArchiveName(skillId, agent))
  const projectRoot = async (project: Project): Promise<string> => {
    if (!project.sourcePath) throw new Error(`Associe uma pasta ao projeto ${project.name}.`)
    const path = await fs.realpath(project.sourcePath)
    if (inside(path, canonicalRoot)) {
      throw new Error('O cofre deve ficar fora da pasta do projeto para preservar skills desativadas fora da descoberta do Copilot.')
    }
    if (!(await fs.stat(path)).isDirectory()) throw new Error(`Pasta de projeto invalida: ${path}`)
    return path
  }
  try {
    for (const skill of next.catalog.skills) {
      const oldSkill = previous.catalog.skills.find(item => item.id === skill.id)
      for (const folder of oldSkill?.publishedFolders ?? []) {
        if (oldSkill?.agents.includes(deploymentAgent(folder)) &&
            !skill.agents.includes(deploymentAgent(folder))) continue
        skill.publishedFolders = (skill.publishedFolders ?? []).filter(item =>
          item.projectId !== folder.projectId || item.projectPath !== folder.projectPath ||
          item.directory !== folder.directory || deploymentRoot(item) !== deploymentRoot(folder))
        rememberFolder(skill, folder)
      }
    }
    for (const oldProject of previous.projects.projects) {
      const newProject = next.projects.projects.find(item => item.id === oldProject.id)
      for (const deployed of oldProject.deployedSkills ?? []) {
        const agent = deploymentAgent(deployed)
        if (agentScope && agent !== agentScope) continue
        const agentDirectory = deploymentRoot(deployed)
        if (newProject && newProject.sourcePath === oldProject.sourcePath &&
            isAgentLinked(newProject, deployed.skillId, agent)) continue
        const path = await projectRoot(oldProject)
        const skill = next.catalog.skills.find(item => item.id === deployed.skillId)
        const folderPath = await directory(path, [agentDirectory, 'skills', deployed.directory])
        const source = join(folderPath, 'SKILL.md')
        const content = await readFile(source)
        const originsToPreserve: Skill[] = []
        for (const item of [...previous.catalog.skills, ...next.catalog.skills]) {
          if (content && item.id === deployed.skillId && await isImportedOrigin(item, source)) continue
          originsToPreserve.push(item)
        }
        if (skill) {
          const known = skill.publishedFolders?.find(item => item.projectId === oldProject.id &&
            item.projectPath === path && item.directory === deployed.directory &&
            deploymentRoot(item) === agentDirectory)
          let marker = known?.marker
          let owned = known?.owned ?? false
          if (owned && marker &&
              !await validMarker(join(folderPath, `.skillvortex-${marker}`), deployed.skillId)) {
            owned = false
            marker = undefined
          }
          rememberFolder(skill, {
            projectId: oldProject.id, projectPath: path, directory: deployed.directory,
            owned, marker, ...(deployed.agent ? { agent, agentDirectory } : {})
          })
        }
        if (content) {
          const archived = await archivedPath(oldProject, deployed.skillId, agent)
          await assertImportedOriginsPreserved(originsToPreserve, [], [source])
          await assertImportedOriginsPreserved(
            [...previous.catalog.skills, ...next.catalog.skills], [], [archived]
          )
          await write(archived, content)
          await remove(source, content)
        }
        const knownFolder = skill?.publishedFolders?.find(item =>
          item.projectId === oldProject.id && item.projectPath === path &&
          item.directory === deployed.directory && deploymentRoot(item) === agentDirectory)
        const markerName = knownFolder?.owned && knownFolder.marker
          ? `.skillvortex-${knownFolder.marker}` : undefined
        const remaining = await fs.readdir(folderPath)
        if (remaining.length === 0 ||
            (remaining.length === 1 && remaining[0] === markerName)) {
          await assertImportedOriginsPreserved(
            originsToPreserve, [folderPath], []
          )
          if (markerName && remaining.length) {
            const markerPath = join(folderPath, markerName)
            const markerContent = await readFile(markerPath)
            if (!markerContent) throw new Error(`Identificacao da pasta publicada ausente: ${folderPath}`)
            await remove(markerPath, markerContent)
          }
          await fs.rmdir(folderPath)
          undo.push(async () => { await fs.mkdir(folderPath) })
        }
      }
    }
    for (const project of next.projects.projects) {
      const oldProject = previous.projects.projects.find(item => item.id === project.id)
      if (!project.sourcePath && !project.deployedSkills?.length && oldProject &&
          projectBindings(project).every(item => isAgentLinked(oldProject, item.skillId, item.agent))) continue
      const deployedSkills: NonNullable<Project['deployedSkills']> = agentScope
        ? (project.deployedSkills ?? []).filter(item => deploymentAgent(item) !== agentScope) : []
      const usedDirectories = new Set<string>()
      for (const { skillId, agent } of projectBindings(project)) {
        if (agentScope && agent !== agentScope) continue
        const skill = next.catalog.skills.find(item => item.id === skillId)
        if (!skill || skill.status === 'blocked') throw new Error('Skill ausente ou bloqueada.')
        const path = await projectRoot(project)
        const existing = oldProject && oldProject.sourcePath === project.sourcePath
          ? oldProject.deployedSkills?.find(item => item.skillId === skillId && deploymentAgent(item) === agent)
          : undefined
        if (existing && isDirectoryVariant(skillDirectory(skill), existing.directory)) {
          const unchanged = markdown(skill, existing.directory,
            await readContained(canonicalRoot, join(canonicalRoot, skill.filePath)))
          if (hash(unchanged) === existing.sourceHash) {
            usedDirectories.add(`${deploymentRoot(existing)}:${existing.directory}`)
            deployedSkills.push(existing)
            continue
          }
        }
        const shared = project.sharedPublication && agent === 'Antigravity' && !agentScope &&
          projectBindings(project).filter(item => item.skillId === skillId).length === 1
        const agents: SkillAgent[] = ['GitHub Copilot', 'Antigravity']
        const archivePaths = existing ? [] : shared
          ? await Promise.all(agents.map(value => archivedPath(project, skillId, value)))
          : [await archivedPath(project, skillId, agent)]
        const archives: Array<{ path: string; content: Buffer }> = []
        for (const archivePath of archivePaths) {
          const content = await readFile(archivePath)
          if (content) archives.push({ path: archivePath, content })
        }
        const preserved = archives[0]?.content
        if (preserved && archives.some(item => !item.content.equals(preserved))) {
          throw new Error(`Existem copias desativadas diferentes para ${skill.name}. Revise os arquivos no cofre antes de consolidar a publicacao compartilhada.`)
        }
        const baseName = (preserved ? archivedSkillDirectory(preserved) : undefined) ??
          skillDirectory(skill)
        const knownAgentFolder = skill.publishedFolders?.find(item => item.projectId === project.id &&
          item.projectPath === path && deploymentAgent(item) === agent)
        let canonicalOrigin = skill.originPath?.startsWith('~/')
          ? join(homedir(), skill.originPath.slice(2)) : skill.originPath
        if (canonicalOrigin && isAbsolute(canonicalOrigin)) {
          try {
            canonicalOrigin = await fs.realpath(canonicalOrigin)
          } catch (error) {
            if (!hasErrorCode(error, 'ENOENT')) throw error
          }
        }
        const importedRelativePath = canonicalOrigin && isAbsolute(canonicalOrigin)
          ? relative(path, canonicalOrigin).split(sep) : []
        const importedAgentDirectory = agent === 'Antigravity' &&
          importedRelativePath[0] === '.agent' && importedRelativePath[1] === 'skills' ? '.agent' : undefined
        const agentDirectory = existing ? deploymentRoot(existing)
          : shared ? '.agents'
            : knownAgentFolder ? deploymentRoot(knownAgentFolder) : importedAgentDirectory ?? agentRoot(agent)
        let name = existing && isDirectoryVariant(baseName, existing.directory)
          ? existing.directory : baseName
        let suffix = 2
        const claimedByAnotherSkill = (candidate: string) => next.catalog.skills.some(other =>
          other.id !== skillId && other.publishedFolders?.some(folder =>
            folder.projectPath === path && folder.directory === candidate &&
            deploymentRoot(folder) === agentDirectory))
        while (usedDirectories.has(`${agentDirectory}:${name}`) || claimedByAnotherSkill(name)) {
          const tail = `-${suffix++}`
          name = `${baseName.slice(0, 64 - tail.length).replace(/-+$/g, '')}${tail}`
        }
        usedDirectories.add(`${agentDirectory}:${name}`)
        const skillsRoot = await directory(path, [agentDirectory, 'skills'])
        const previousFolder = existing && skill.publishedFolders?.find(item =>
          item.projectId === project.id && item.projectPath === path && item.directory === existing.directory &&
          deploymentRoot(item) === agentDirectory)
        const knownFolder = skill.publishedFolders?.find(item =>
          item.projectId === project.id && item.projectPath === path && item.directory === name &&
          deploymentRoot(item) === agentDirectory)
        if (existing && name !== existing.directory) {
          const previousDirectory = join(skillsRoot, existing.directory)
          const nextDirectory = join(skillsRoot, name)
          const stat = await fs.lstat(previousDirectory)
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`Diretorio de skill invalido ou simbolico: ${previousDirectory}`)
          }
          if (!previousFolder?.owned || (previousFolder.marker &&
              !await validMarker(join(previousDirectory, `.skillvortex-${previousFolder.marker}`), skillId))) {
            throw new Error(`Nao foi possivel identificar a pasta para renomear: ${previousDirectory}`)
          }
          await assertImportedOriginsPreserved(
            [...previous.catalog.skills, ...next.catalog.skills], [previousDirectory], []
          )
          try {
            await fs.lstat(nextDirectory)
            throw new Error(`O diretorio de destino ja existe: ${nextDirectory}`)
          } catch (error) {
            if (!hasErrorCode(error, 'ENOENT')) throw error
          }
          await fs.rename(previousDirectory, nextDirectory)
          undo.push(() => fs.rename(nextDirectory, previousDirectory))
          skill.publishedFolders = skill.publishedFolders?.filter(item =>
            item.projectId !== project.id || item.projectPath !== path || item.directory !== existing.directory ||
            deploymentRoot(item) !== agentDirectory)
        }
        const folderPath = join(skillsRoot, name)
        let created = false
        try {
          await fs.mkdir(folderPath)
          created = true
          undo.push(() => fs.rmdir(folderPath))
        } catch (error) {
          if (!hasErrorCode(error, 'EEXIST')) throw error
        }
        const folderStat = await fs.lstat(folderPath)
        if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) {
          throw new Error(`Diretorio de skills invalido ou simbolico: ${folderPath}`)
        }
        if (created && !existing && knownFolder) {
          knownFolder.owned = true
          knownFolder.marker = undefined
        }
        let owned = existing ? (previousFolder?.owned ?? false)
          : (knownFolder?.owned ?? created)
        let marker = existing ? previousFolder?.marker : knownFolder?.marker
        if (created) marker = undefined
        if (owned && !created && marker &&
            !await validMarker(join(folderPath, `.skillvortex-${marker}`), skillId)) {
          owned = false
          marker = undefined
        }
        const destination = join(folderPath, 'SKILL.md')
        const agentMetadata = project.agentBindings || agent !== 'GitHub Copilot' ? { agent, agentDirectory } : {}
        rememberFolder(skill, { projectId: project.id, projectPath: path, directory: name, owned, marker, ...agentMetadata })
        const sourceContent = await readContained(canonicalRoot, join(canonicalRoot, skill.filePath))
        const content = markdown(skill, name, sourceContent)
        if (existing) {
          if (name === existing.directory && hash(content) === existing.sourceHash) {
            deployedSkills.push(existing)
            continue
          }
          const current = await readFile(destination)
          if (!current) throw new Error(`Skill ativada nao encontrada: ${destination}. Restaure o arquivo antes de continuar.`)
          if (name !== existing.directory && hash(current) === existing.hash) {
            const previousSkill = previous.catalog.skills.find(item => item.id === skillId)
            const previousSource = previousSkill
              ? markdown(previousSkill, existing.directory,
                await readContained(canonicalRoot, join(canonicalRoot, previousSkill.filePath)))
              : undefined
            const bodyChanged = !previousSource || markdownBody(previousSource) !== markdownBody(content)
            const renamed = bodyChanged ? content : updateFrontmatter(current, skill, name)
            if (!renamed.equals(current)) {
              await remove(destination, current)
              await write(destination, renamed)
            }
            deployedSkills.push({
              ...existing,
              directory: name,
              hash: hash(renamed),
              sourceHash: hash(content)
            })
            continue
          }
          if (hash(content) === existing.sourceHash) {
            if (name === existing.directory) {
              deployedSkills.push(existing)
              continue
            }
            const renamed = updateFrontmatter(current, skill, name)
            if (!renamed.equals(current)) {
              await remove(destination, current)
              await write(destination, renamed)
              deployedSkills.push({
                ...existing, directory: name, hash: hash(renamed), sourceHash: hash(content)
              })
            } else {
              deployedSkills.push({ ...existing, directory: name })
            }
            continue
          }
          if (hash(current) !== existing.hash) {
            throw new Error(`A skill foi editada ou removida no projeto: ${destination}. Desative e reative para preservar a edicao antes de sincronizar.`)
          }
          await remove(destination, current)
          await write(destination, content)
          deployedSkills.push({ skillId, directory: name, hash: hash(content), sourceHash: hash(content), ...agentMetadata })
        } else {
          let published = preserved ?? content
          if (shared) {
            const metadata = skillMarkdownMetadata(published.toString('utf8'))
            if (!metadata.name || !metadata.description) {
              published = markdown(skill, name, published.toString('utf8'))
            } else if (metadata.name !== name || metadata.description.length > 1024) {
              throw new Error(`A copia arquivada de ${skill.name} nao segue o padrao Agent Skills. Revise name e description antes de restaurar.`)
            }
          }
          const current = await readFile(destination)
          if (shared && current) {
            const metadata = skillMarkdownMetadata(current.toString('utf8'))
            if (metadata.name !== name || !metadata.description || metadata.description.length > 1024) {
              throw new Error(`O arquivo existente nao segue o padrao Agent Skills: ${destination}. O original foi preservado; revise-o ou publique com outro nome.`)
            }
          }
          const importedOrigin = current ? await isImportedOrigin(skill, destination) : false
          if (current && preserved && !current.equals(preserved)) {
            throw new Error(`O SKILL.md do projeto difere da copia desativada no cofre: ${destination}. Preserve e revise as duas versoes antes de reativar.`)
          }
          if (current && !importedOrigin && !current.equals(published) &&
              !current.equals(Buffer.from(sourceContent))) {
            throw new Error(`Ja existe outro SKILL.md nesta pasta: ${destination}. Importe esse arquivo ou escolha outro nome para a skill; o arquivo existente foi preservado.`)
          }
          if (!current) await write(destination, published)
          if (preserved && (!current || current.equals(preserved))) {
            for (const archive of archives) await remove(archive.path, archive.content)
          }
          deployedSkills.push({ skillId, directory: name, hash: hash(current ?? published), sourceHash: hash(content), ...agentMetadata })
        }
      }
      if (deployedSkills.length || project.deployedSkills) project.deployedSkills = deployedSkills
    }
    await save(canonicalRoot, next)
  } catch (error) {
    const errors: unknown[] = []
    for (const action of undo.reverse()) {
      try {
        await action()
      } catch (rollbackError) {
        errors.push(rollbackError)
      }
    }
    if (errors.length) throw new AggregateError([error, ...errors], 'Falha ao sincronizar skills e restaurar arquivos. Preserve o cofre e os arquivos do projeto.')
    throw error
  }
}
