import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { hasErrorCode, skillSlug, type Skill, type VaultData } from './model'
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

function skillDirectory(skill: Skill): string {
  return skillSlug(skill.name)
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
    for (const oldProject of previous.projects.projects) {
      const newProject = next.projects.projects.find(item => item.id === oldProject.id)
      for (const deployed of oldProject.deployedSkills ?? []) {
        if (newProject && newProject.sourcePath === oldProject.sourcePath &&
            newProject.skillIds.includes(deployed.skillId)) continue
        const source = join(await directory(await projectRoot(oldProject),
          ['.github', 'skills', deployed.directory]), 'SKILL.md')
        const content = await readFile(source)
        if (!content) throw new Error(`Skill ativada nao encontrada: ${source}. Restaure o arquivo antes de desativar.`)
        const archived = await archivedPath(oldProject, deployed.skillId)
        await write(archived, content)
        await remove(source, content)
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
        let name = baseName
        let suffix = 2
        while (usedDirectories.has(name)) name = `${baseName.slice(0, 61)}-${suffix++}`
        usedDirectories.add(name)
        const skillsRoot = await directory(path, ['.github', 'skills'])
        if (existing && name !== existing.directory) {
          const previousDirectory = join(skillsRoot, existing.directory)
          const nextDirectory = join(skillsRoot, name)
          const stat = await fs.lstat(previousDirectory)
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(`Diretorio de skill invalido ou simbolico: ${previousDirectory}`)
          }
          try {
            await fs.lstat(nextDirectory)
            throw new Error(`O diretorio de destino ja existe: ${nextDirectory}`)
          } catch (error) {
            if (!hasErrorCode(error, 'ENOENT')) throw error
          }
          await fs.rename(previousDirectory, nextDirectory)
          undo.push(() => fs.rename(nextDirectory, previousDirectory))
        }
        const destination = join(await directory(path, ['.github', 'skills', name]), 'SKILL.md')
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
