import { promises as fs } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { hasErrorCode, skillSlug, type Skill, type VaultData } from './model'
import { assertImportedOriginsPreserved } from './skill-deletion'
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
    item.projectPath === folder.projectPath && item.directory === folder.directory)
  if (existing) {
    existing.owned = existing.owned && folder.owned
    existing.marker = existing.owned ? folder.marker ?? existing.marker : undefined
  } else folders.push({ ...folder })
  skill.publishedFolders = folders
}

function archivedSkillDirectory(content: Buffer): string | undefined {
  const frontmatter = content.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const name = frontmatter?.[1].match(/^name:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/m)?.[1]
  return name
}

function updateFrontmatter(content: Buffer, skill: Skill, name: string): Buffer {
  const text = content.toString('utf8')
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (!frontmatter || !/^name:/m.test(frontmatter[0]) || !/^description:/m.test(frontmatter[0])) {
    throw new Error(`Frontmatter da skill invalido; nao foi possivel renomear: ${skill.name}`)
  }
  const updated = frontmatter[0]
    .replace(/^name:[^\r\n]*/m, `name: ${name}`)
    .replace(/^description:[^\r\n]*/m, `description: ${JSON.stringify(skill.description.trim())}`)
  return Buffer.from(`${updated}${text.slice(frontmatter[0].length)}`)
}

function markdownBody(content: Buffer): string {
  const text = content.toString('utf8')
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  return frontmatter ? text.slice(frontmatter[0].length) : text
}

function markdown(skill: Skill, name: string, content: string): Buffer {
  if (!skill.description.trim()) throw new Error(`Informe a descricao da skill ${skill.name}.`)
  return Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(skill.description.trim())}\n---\n\n${content}`)
}

// Journal filesystem changes so a metadata failure cannot leave the switch out of sync.
export async function saveProjectSkills(
  root: string,
  previous: VaultData,
  next: VaultData,
  save: (root: string, data: VaultData) => Promise<void> = saveVaultData
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
  const archivedPath = async (project: Project, skillId: string) =>
    join(await directory(canonicalRoot, ['.skillvortex', 'disabled-skills', hash(project.id)]),
      `${hash(skillId)}.md`)
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
        skill.publishedFolders = (skill.publishedFolders ?? []).filter(item =>
          item.projectId !== folder.projectId || item.projectPath !== folder.projectPath ||
          item.directory !== folder.directory)
        rememberFolder(skill, folder)
      }
    }
    for (const oldProject of previous.projects.projects) {
      const newProject = next.projects.projects.find(item => item.id === oldProject.id)
      for (const deployed of oldProject.deployedSkills ?? []) {
        if (newProject && newProject.sourcePath === oldProject.sourcePath &&
            newProject.skillIds.includes(deployed.skillId)) continue
        const path = await projectRoot(oldProject)
        const skill = next.catalog.skills.find(item => item.id === deployed.skillId)
        const folderPath = await directory(path, ['.github', 'skills', deployed.directory])
        const source = join(folderPath, 'SKILL.md')
        const content = await readFile(source)
        if (!content) throw new Error(`Skill ativada nao encontrada: ${source}. Restaure o arquivo antes de desativar.`)
        if (skill) {
          const known = skill.publishedFolders?.find(item => item.projectId === oldProject.id &&
            item.projectPath === path && item.directory === deployed.directory)
          let marker = known?.marker
          let owned = known?.owned ?? false
          if (owned && (!marker ||
              !await validMarker(join(folderPath, `.skillvortex-${marker}`), deployed.skillId))) {
            owned = false
            marker = undefined
          }
          rememberFolder(skill, {
            projectId: oldProject.id, projectPath: path, directory: deployed.directory,
            owned, marker
          })
        }
        const archived = await archivedPath(oldProject, deployed.skillId)
        await write(archived, content)
        await remove(source, content)
        const knownFolder = skill?.publishedFolders?.find(item =>
          item.projectId === oldProject.id && item.projectPath === path &&
          item.directory === deployed.directory)
        const markerName = knownFolder?.owned && knownFolder.marker
          ? `.skillvortex-${knownFolder.marker}` : undefined
        const remaining = await fs.readdir(folderPath)
        if (remaining.length === 0 ||
            (remaining.length === 1 && remaining[0] === markerName)) {
          await assertImportedOriginsPreserved(
            [...previous.catalog.skills, ...next.catalog.skills], [folderPath], []
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
          project.skillIds.every(id => oldProject.skillIds.includes(id))) continue
      const deployedSkills: NonNullable<Project['deployedSkills']> = []
      const usedDirectories = new Set<string>()
      for (const skillId of project.skillIds) {
        const skill = next.catalog.skills.find(item => item.id === skillId)
        if (!skill || skill.status === 'blocked') throw new Error('Skill ausente ou bloqueada.')
        const path = await projectRoot(project)
        const existing = oldProject && oldProject.sourcePath === project.sourcePath
          ? oldProject.deployedSkills?.find(item => item.skillId === skillId)
          : undefined
        const archived = existing ? undefined : await archivedPath(project, skillId)
        const preserved = archived ? await readFile(archived) : undefined
        const baseName = (preserved ? archivedSkillDirectory(preserved) : undefined) ??
          skillDirectory(skill)
        let name = existing && isDirectoryVariant(baseName, existing.directory)
          ? existing.directory : baseName
        let suffix = 2
        const claimedByAnotherSkill = (candidate: string) => next.catalog.skills.some(other =>
          other.id !== skillId && other.publishedFolders?.some(folder =>
            folder.projectPath === path && folder.directory === candidate))
        while (usedDirectories.has(name) || claimedByAnotherSkill(name)) {
          const tail = `-${suffix++}`
          name = `${baseName.slice(0, 64 - tail.length).replace(/-+$/g, '')}${tail}`
        }
        usedDirectories.add(name)
        const skillsRoot = await directory(path, ['.github', 'skills'])
        const previousFolder = existing && skill.publishedFolders?.find(item =>
          item.projectId === project.id && item.projectPath === path && item.directory === existing.directory)
        const knownFolder = skill.publishedFolders?.find(item =>
          item.projectId === project.id && item.projectPath === path && item.directory === name)
        if (existing && name !== existing.directory) {
          const previousDirectory = join(skillsRoot, existing.directory)
          const nextDirectory = join(skillsRoot, name)
          const stat = await fs.lstat(previousDirectory)
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`Diretorio de skill invalido ou simbolico: ${previousDirectory}`)
          }
          if (!previousFolder?.owned || !previousFolder.marker ||
              !await validMarker(join(previousDirectory, `.skillvortex-${previousFolder.marker}`), skillId)) {
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
            item.projectId !== project.id || item.projectPath !== path || item.directory !== existing.directory)
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
        if (owned && !created && (!marker ||
            !await validMarker(join(folderPath, `.skillvortex-${marker}`), skillId))) {
          owned = false
          marker = undefined
        }
        if (owned && created) {
          marker = randomBytes(16).toString('hex')
          await write(join(folderPath, `.skillvortex-${marker}`), Buffer.from(skillId))
        }
        const destination = join(folderPath, 'SKILL.md')
        rememberFolder(skill, { projectId: project.id, projectPath: path, directory: name, owned, marker })
        const content = markdown(skill, name, await readContained(canonicalRoot, join(canonicalRoot, skill.filePath)))
        if (existing) {
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
          deployedSkills.push({ skillId, directory: name, hash: hash(content), sourceHash: hash(content) })
        } else {
          const published = preserved ?? content
          await write(destination, published)
          if (preserved && archived) await remove(archived, preserved)
          deployedSkills.push({ skillId, directory: name, hash: hash(published), sourceHash: hash(content) })
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
