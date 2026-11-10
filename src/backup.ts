import { randomUUID } from 'node:crypto'
import { promises as fs, type Dirent } from 'node:fs'
import { join, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'
import { hasErrorCode, type VaultData } from './model'
import { readContained, readVault, saveVaultData, writeSkillFile } from './vault'
import { mindCardsSnapshot, restoreMindCardsSnapshot } from './mindcards'

const manifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().min(1),
  mindcards: z.boolean().optional()
})

export interface VaultBackup {
  id: string
  createdAt: string
  skills: number
  projects: number
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return Boolean(path) && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`)
}

async function backupDirectory(root: string, create = false): Promise<string> {
  const canonicalRoot = await fs.realpath(root)
  const metadata = await fs.realpath(join(canonicalRoot, '.skillvortex'))
  if (!isWithin(canonicalRoot, metadata)) throw new Error('Diretorio de metadados fora da biblioteca.')
  const directory = join(metadata, 'backups')
  if (create) await fs.mkdir(directory, { recursive: true })
  const canonicalDirectory = await fs.realpath(directory)
  if (!isWithin(canonicalRoot, canonicalDirectory)) throw new Error('Diretorio de backups fora da biblioteca.')
  return canonicalDirectory
}

export async function createVaultBackup(root: string): Promise<VaultBackup> {
  const canonicalRoot = await fs.realpath(root)
  const data = await readVault(canonicalRoot)
  const notes = await mindCardsSnapshot(canonicalRoot)
  const backups = await backupDirectory(canonicalRoot, true)
  const createdAt = new Date().toISOString()
  const id = `backup-${createdAt.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const staging = join(backups, `.pending-${randomUUID()}`)
  const destination = join(backups, id)

  try {
    await fs.mkdir(join(staging, 'skills'), { recursive: true })
    await fs.mkdir(join(staging, '.skillvortex'), { recursive: true })
    for (const skill of data.catalog.skills) {
      const content = await readContained(canonicalRoot, join(canonicalRoot, skill.filePath))
      await fs.writeFile(join(staging, skill.filePath), content, { flag: 'wx' })
    }
    await fs.writeFile(join(staging, '.skillvortex/catalogo.json'), JSON.stringify(data.catalog, null, 2))
    await fs.writeFile(join(staging, '.skillvortex/projetos.json'), JSON.stringify(data.projects, null, 2))
    if (notes) {
      await fs.mkdir(join(staging, 'mindcards'))
      for (const [name, content] of notes) await fs.writeFile(join(staging, 'mindcards', name), content, { flag: 'wx' })
    }
    await fs.writeFile(join(staging, 'backup.json'), JSON.stringify({ version: 1, createdAt, mindcards: true }, null, 2))
    await fs.rename(staging, destination)
    return { id, createdAt, skills: data.catalog.skills.length, projects: data.projects.projects.length }
  } catch (error) {
    try {
      await fs.rm(staging, { recursive: true, force: true })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Falha ao criar e limpar o backup incompleto.')
    }
    throw error
  }
}

export async function listVaultBackups(root: string): Promise<VaultBackup[]> {
  let backups: string
  try {
    backups = await backupDirectory(root)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return []
    throw error
  }
  let entries: Dirent[]
  try {
    entries = await fs.readdir(backups, { withFileTypes: true })
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return []
    throw error
  }

  const results: VaultBackup[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue
    const snapshot = join(backups, entry.name)
    try {
      const [manifestText, data] = await Promise.all([
        readContained(snapshot, join(snapshot, 'backup.json')),
        readVault(snapshot)
      ])
      const manifest = manifestSchema.parse(JSON.parse(manifestText))
      if (manifest.mindcards) await mindCardsSnapshot(snapshot)
      results.push({
        id: entry.name,
        createdAt: manifest.createdAt,
        skills: data.catalog.skills.length,
        projects: data.projects.projects.length
      })
    } catch (error) {
      throw new Error(`Backup invalido (${entry.name}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return results.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

async function readBackup(root: string, id: string): Promise<{
  data: VaultData; contents: Map<string, string>; notes?: Map<string, string> | null
}> {
  if (!/^backup-[a-zA-Z0-9T_-]+$/.test(id)) throw new Error('Identificador de backup invalido.')
  const backups = await backupDirectory(root)
  const snapshot = join(backups, id)
  const canonicalSnapshot = await fs.realpath(snapshot)
  const canonicalBackups = await fs.realpath(backups)
  if (!isWithin(canonicalBackups, canonicalSnapshot)) {
    throw new Error('Backup fora da biblioteca.')
  }
  const data = await readVault(canonicalSnapshot)
  const manifest = manifestSchema.parse(JSON.parse(await readContained(canonicalSnapshot, join(canonicalSnapshot, 'backup.json'))))
  const notes = manifest.mindcards ? await mindCardsSnapshot(canonicalSnapshot) : undefined
  const contents = new Map<string, string>()
  for (const skill of data.catalog.skills) {
    contents.set(skill.id, await readContained(canonicalSnapshot, join(canonicalSnapshot, skill.filePath)))
  }
  return { data, contents, notes }
}

async function readCurrentContents(
  root: string,
  data: VaultData,
  additionalPaths: string[]
): Promise<Map<string, string | undefined>> {
  const contents = new Map<string, string | undefined>()
  for (const filePath of new Set([...data.catalog.skills.map(skill => skill.filePath), ...additionalPaths])) {
    try {
      contents.set(filePath, await readContained(root, join(root, filePath)))
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      contents.set(filePath, undefined)
    }
  }
  return contents
}

export async function restoreVaultBackup(
  root: string,
  id: string,
  save: (root: string, data: VaultData) => Promise<void> = saveVaultData
): Promise<{ restored: VaultBackup; recoveryPoint: VaultBackup; warning?: string }> {
  const canonicalRoot = await fs.realpath(root)
  const selected = await readBackup(canonicalRoot, id)
  const current = await readVault(canonicalRoot)
  const currentNotes = selected.notes !== undefined ? await mindCardsSnapshot(canonicalRoot) : undefined
  const currentContents = await readCurrentContents(
    canonicalRoot, current, selected.data.catalog.skills.map(skill => skill.filePath)
  )
  const recoveryPoint = await createVaultBackup(canonicalRoot)
  const changed: string[] = []
  let metadataWriteStarted = false
  let notesWriteStarted = false

  try {
    for (const skill of selected.data.catalog.skills) {
      const content = selected.contents.get(skill.id)
      if (content === undefined) throw new Error(`Conteudo ausente no backup: ${skill.name}`)
      changed.push(skill.filePath)
      await writeSkillFile(canonicalRoot, skill.filePath, content)
    }
    if (selected.notes !== undefined) {
      notesWriteStarted = true
      await restoreMindCardsSnapshot(canonicalRoot, selected.notes)
    }
    metadataWriteStarted = true
    await save(canonicalRoot, selected.data)
  } catch (error) {
    if (metadataWriteStarted) {
      try {
        const persisted = await readVault(canonicalRoot)
        if (JSON.stringify(persisted) === JSON.stringify(selected.data)) {
          return {
            restored: {
              id,
              createdAt: new Date().toISOString(),
              skills: selected.data.catalog.skills.length,
              projects: selected.data.projects.projects.length
            },
            recoveryPoint,
            warning: `Os dados foram restaurados, mas houve uma falha na limpeza de arquivos temporarios: ${error instanceof Error ? error.message : String(error)}`
          }
        }
      } catch (verificationError) {
        throw new AggregateError(
          [error, verificationError],
          `Nao foi possivel confirmar a restauracao. Preserve a biblioteca e o ponto de recuperacao ${recoveryPoint.id}.`
        )
      }
    }
    const rollbackErrors: unknown[] = []
    if (notesWriteStarted && currentNotes !== undefined) {
      try { await restoreMindCardsSnapshot(canonicalRoot, currentNotes) } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    for (const filePath of changed.reverse()) {
      const previous = currentContents.get(filePath)
      try {
        if (previous === undefined) await fs.unlink(join(canonicalRoot, filePath))
        else await writeSkillFile(canonicalRoot, filePath, previous)
      } catch (rollbackError) {
        if (!hasErrorCode(rollbackError, 'ENOENT')) rollbackErrors.push(rollbackError)
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Falha ao restaurar backup. O ponto de recuperacao foi preservado: ${recoveryPoint.id}.`
      )
    }
    throw error
  }

  return {
    restored: {
      id,
      createdAt: new Date().toISOString(),
      skills: selected.data.catalog.skills.length,
      projects: selected.data.projects.projects.length
    },
    recoveryPoint
  }
}
