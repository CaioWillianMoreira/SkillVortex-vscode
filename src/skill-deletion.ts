import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  agentSkillKey, deploymentAgent, deploymentRoot, hasErrorCode, isAgentLinked, projectBindings,
  setProjectBindings, type Skill, type SkillAgent, type VaultData
} from './model'
import { readContained, readVault } from './vault'

interface DeletionPlan {
  skillId: string
  vaultFile: string
  folders: string[]
  archives: string[]
  agent?: SkillAgent
  deleteVault?: boolean
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export const skillArchiveName = (skillId: string, agent: SkillAgent): string =>
  `${hash(agent === 'GitHub Copilot' ? skillId : agentSkillKey(skillId, agent))}.md`

function inside(root: string, path: string): boolean {
  const value = relative(root, path)
  return !isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`)
}

function samePath(left: string, right: string): boolean {
  return !relative(left, right) && !relative(right, left)
}

async function optionalDirectory(root: string, parts: string[]): Promise<string | undefined> {
  let path = root
  for (const part of parts) {
    path = join(path, part)
    try {
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`Diretorio invalido ou simbolico: ${path}`)
      }
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return undefined
      throw error
    }
  }
  return path
}

async function optionalFile(path: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Arquivo invalido ou simbolico: ${path}`)
    }
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

export function assertSkillInactive(data: VaultData, skillId: string): void {
  if (data.projects.projects.some(project => project.skillIds.includes(skillId))) {
    throw new Error('Desative a skill em todos os projetos antes de editar, desvincular ou excluir.')
  }
}

export async function assertImportedOriginsPreserved(
  skills: Skill[], folders: string[], files: string[]
): Promise<void> {
  for (const item of skills) {
    if (!item.originPath) continue
    const originPath = item.originPath.startsWith('~/')
      ? join(homedir(), item.originPath.slice(2)) : item.originPath
    if (!isAbsolute(originPath)) throw new Error(`Caminho de origem invalido: ${item.originPath}`)
    const paths = [resolve(originPath)]
    try {
      paths.push(join(await fs.realpath(dirname(originPath)), basename(originPath)))
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
    try {
      paths.push(await fs.realpath(originPath))
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
    for (const origin of paths) {
      if (files.some(file => samePath(origin, file)) ||
          folders.some(folder => inside(folder, origin))) {
        throw new Error(`A operacao alteraria um arquivo de origem importado: ${item.originPath}`)
      }
    }
  }
}

export async function planSkillDeletion(root: string, data: VaultData, skill: Skill, agent?: SkillAgent): Promise<DeletionPlan> {
  if (agent) {
    if (data.projects.projects.some(project => isAgentLinked(project, skill.id, agent))) {
      throw new Error('Desative a skill deste agente em todos os projetos antes de excluir.')
    }
  } else assertSkillInactive(data, skill.id)
  const canonicalRoot = await fs.realpath(root)
  const vaultDirectory = await optionalDirectory(canonicalRoot, ['skills'])
  if (!vaultDirectory) throw new Error('Diretorio de skills do cofre nao encontrado.')
  const vaultFile = join(canonicalRoot, skill.filePath)
  if (!await optionalFile(vaultFile)) throw new Error(`Markdown do cofre nao encontrado: ${vaultFile}`)
  await readContained(canonicalRoot, vaultFile)

  const folders = new Set<string>()
  for (const folder of skill.publishedFolders ?? []) {
    if (agent && deploymentAgent(folder) !== agent) continue
    if (!isAbsolute(folder.projectPath)) throw new Error(`Caminho de projeto invalido: ${folder.projectPath}`)
    const projectPath = await fs.realpath(folder.projectPath)
    if (!samePath(resolve(folder.projectPath), projectPath)) {
      throw new Error(`A pasta do projeto foi alterada ou redirecionada: ${folder.projectPath}`)
    }
    const target = await optionalDirectory(projectPath, [deploymentRoot(folder), 'skills', folder.directory])
    if (!target) continue
    if (inside(target, canonicalRoot)) throw new Error(`A pasta publicada contem o cofre: ${target}`)
    if (!folder.owned) {
      throw new Error(`A pasta nao foi identificada como criada pelo SkillVortex: ${target}. Preserve seus arquivos e remova-a manualmente, se desejar.`)
    }
    if (folder.marker) {
      const marker = join(target, `.skillvortex-${folder.marker}`)
      if (!await optionalFile(marker) || (await fs.lstat(marker)).size > 800 ||
          await fs.readFile(marker, 'utf8') !== skill.id) {
        throw new Error(`Identificacao da pasta publicada ausente ou alterada: ${target}`)
      }
    }
    for (const other of data.catalog.skills) {
      if (other.id === skill.id) continue
      if (other.publishedFolders?.some(item =>
        samePath(resolve(item.projectPath), projectPath) && item.directory === folder.directory &&
        deploymentRoot(item) === deploymentRoot(folder))) {
        throw new Error(`A pasta publicada tambem pertence a outra skill: ${target}`)
      }
    }
    for (const project of data.projects.projects) {
      if (!project.sourcePath || !project.deployedSkills?.length) continue
      const activeRoot = await fs.realpath(project.sourcePath)
      if (samePath(activeRoot, projectPath) && project.deployedSkills.some(item =>
        item.skillId !== skill.id && item.directory === folder.directory &&
        deploymentRoot(item) === deploymentRoot(folder))) {
        throw new Error(`A pasta publicada esta em uso por outra skill: ${target}`)
      }
    }
    folders.add(target)
  }

  const archives: string[] = []
  const archiveRoot = await optionalDirectory(canonicalRoot, ['.skillvortex', 'disabled-skills'])
  const knownProjects = new Set((skill.publishedFolders ?? []).map(folder => hash(folder.projectId)))
  if (archiveRoot) {
    for (const entry of await fs.readdir(archiveRoot)) {
      if (!/^[a-f0-9]{64}$/.test(entry)) continue
      const archiveDirectory = await optionalDirectory(archiveRoot, [entry])
      if (!archiveDirectory) continue
      for (const archiveAgent of agent ? [agent] : ['GitHub Copilot', 'Antigravity'] as const) {
        const archive = join(archiveDirectory, skillArchiveName(skill.id, archiveAgent))
        if (!await optionalFile(archive)) continue
        if (!knownProjects.has(entry)) {
          throw new Error(`Esta skill foi desativada em uma versao antiga sem registrar sua pasta. Preserve os arquivos e remova manualmente a pasta antiga e o arquivo arquivado ${archive}, ou ative e desative a skill no projeto correspondente antes de excluir.`)
        }
        archives.push(archive)
      }
    }
  }

  const deleteVault = !agent || skill.agents.filter(item => item !== agent).length === 0
  await assertImportedOriginsPreserved(data.catalog.skills, [...folders], [...(deleteVault ? [vaultFile] : []), ...archives])
  return { skillId: skill.id, vaultFile, folders: [...folders].sort(), archives: archives.sort(),
    ...(agent ? { agent, deleteVault } : {}) }
}

export async function deleteSkillFiles(
  root: string,
  approved: DeletionPlan,
  save: (root: string, data: VaultData) => Promise<void>
): Promise<void> {
  const data = await readVault(root)
  const skill = data.catalog.skills.find(item => item.id === approved.skillId)
  if (!skill) throw new Error('Skill nao encontrada.')
  const plan = await planSkillDeletion(root, data, skill, approved.agent)
  if (JSON.stringify(plan) !== JSON.stringify(approved)) {
    throw new Error('Os arquivos da skill mudaram apos a confirmacao. Tente excluir novamente.')
  }
  const staged: Array<{ original: string; temporary: string; directory: boolean }> = []
  let saveStarted = false
  try {
    for (const [path, directory] of [
      ...plan.folders.map(path => [path, true] as const),
      ...plan.archives.map(path => [path, false] as const),
      ...(plan.deleteVault === false ? [] : [[plan.vaultFile, false] as const])
    ]) {
      const temporary = join(dirname(path), `.${basename(path)}.skillvortex-delete-${randomUUID()}`)
      if (await optionalFileOrDirectory(temporary)) throw new Error(`Destino temporario ja existe: ${temporary}`)
      await fs.rename(path, temporary)
      staged.push({ original: path, temporary, directory })
    }
    if (plan.deleteVault === false && plan.agent) {
      skill.agents = skill.agents.filter(agent => agent !== plan.agent)
      skill.publishedFolders = skill.publishedFolders?.filter(folder => deploymentAgent(folder) !== plan.agent)
    } else data.catalog.skills = data.catalog.skills.filter(item => item.id !== skill.id)
    if (plan.agent) {
      for (const project of data.projects.projects) {
        setProjectBindings(project, projectBindings(project).filter(item =>
          item.skillId !== skill.id || item.agent !== plan.agent))
        project.deployedSkills = project.deployedSkills?.filter(item =>
          item.skillId !== skill.id || deploymentAgent(item) !== plan.agent)
      }
    }
    saveStarted = true
    await save(root, data)
  } catch (error) {
    if (saveStarted) {
      let persisted: VaultData
      try {
        persisted = await readVault(root)
      } catch (verificationError) {
        throw new AggregateError([error, verificationError],
          `Nao foi possivel verificar os metadados. Arquivos preservados em: ${staged.map(item => item.temporary).join(', ')}`)
      }
      if (!persisted.catalog.skills.some(item => item.id === skill.id) ||
          (plan.agent && !persisted.catalog.skills.find(item => item.id === skill.id)?.agents.includes(plan.agent))) {
        throw new AggregateError([error],
          `Cadastro removido, mas houve uma falha ao salvar. Arquivos preservados em: ${staged.map(item => item.temporary).join(', ')}`)
      }
    }
    const rollbackErrors: unknown[] = []
    for (const item of staged.reverse()) {
      try {
        if (await optionalFileOrDirectory(item.original)) {
          throw new Error(`Nao foi possivel restaurar ${item.original}; o caminho ja existe. Arquivo preservado em ${item.temporary}.`)
        }
        await fs.rename(item.temporary, item.original)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors],
        `Falha ao excluir e restaurar os arquivos. Verifique os caminhos temporarios: ${staged.map(item => item.temporary).join(', ')}`)
    }
    throw error
  }

  const cleanupErrors: unknown[] = []
  const remaining: string[] = []
  for (const item of staged) {
    try {
      if (item.directory) await fs.rm(item.temporary, { recursive: true })
      else await fs.unlink(item.temporary)
    } catch (error) {
      cleanupErrors.push(error)
      remaining.push(item.temporary)
    }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, `Cadastro removido, mas nao foi possivel apagar: ${remaining.join(', ')}`)
  }
}

async function optionalFileOrDirectory(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return false
    throw error
  }
}
