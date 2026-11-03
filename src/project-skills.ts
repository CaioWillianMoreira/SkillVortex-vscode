import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'
import { hasErrorCode, type Skill, type VaultData } from './model'
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
  return `skill-${hash(skill.id).slice(0, 24)}`
}

function markdown(skill: Skill, name: string, content: string): Buffer {
  const description = skill.description.trim() || `Instrucoes para ${skill.name}.`
  return Buffer.from(`---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${content}`)
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
      for (const skillId of project.skillIds) {
        const skill = next.catalog.skills.find(item => item.id === skillId)
        if (!skill || skill.status === 'blocked') throw new Error('Skill ausente ou bloqueada.')
        const path = await projectRoot(project)
        const existing = oldProject && oldProject.sourcePath === project.sourcePath
          ? oldProject.deployedSkills?.find(item => item.skillId === skillId)
          : undefined
        const name = existing?.directory ?? skillDirectory(skill)
        const destination = join(await directory(path, ['.github', 'skills', name]), 'SKILL.md')
        const content = markdown(skill, name, await readContained(canonicalRoot, join(canonicalRoot, skill.filePath)))
        if (existing) {
          const current = await readFile(destination)
          if (!current) throw new Error(`Skill ativada nao encontrada: ${destination}. Restaure o arquivo antes de continuar.`)
          if (hash(content) === existing.sourceHash) {
            deployedSkills.push(existing)
            continue
          }
          if (hash(current) !== existing.hash) {
            throw new Error(`A skill foi editada ou removida no projeto: ${destination}. Desative e reative para preservar a edicao antes de sincronizar.`)
          }
          await remove(destination, current)
          await write(destination, content)
          deployedSkills.push({ skillId, directory: name, hash: hash(content), sourceHash: hash(content) })
        } else {
          const archived = await archivedPath(project, skillId)
          const preserved = await readFile(archived)
          const published = preserved ?? content
          await write(destination, published)
          if (preserved) await remove(archived, preserved)
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
