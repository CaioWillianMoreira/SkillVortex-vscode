import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute, sep, dirname, basename } from 'node:path'
import { emptyVault, validateVault, hasErrorCode, type VaultData } from './model'

export async function readVault(root: string): Promise<VaultData> {
  const canonical = await fs.realpath(root)
  const metadata = join(canonical, '.skillvortex')
  const [catalog, projects] = await Promise.all([
    readContained(canonical, join(metadata, 'catalogo.json')),
    readContained(canonical, join(metadata, 'projetos.json'))
  ])
  return validateVault(JSON.parse(catalog), JSON.parse(projects))
}

export async function readContained(root: string, file: string): Promise<string> {
  const [canonicalRoot, canonicalFile] = await Promise.all([fs.realpath(root), fs.realpath(file)])
  const path = relative(canonicalRoot, canonicalFile)
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error('Arquivo fora do cofre.')
  }
  const stat = await fs.stat(canonicalFile)
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Arquivo invalido ou maior que 16 MB.')
  return fs.readFile(canonicalFile, 'utf8')
}

export async function writeSkillFile(root: string, filePath: string, content: string): Promise<void> {
  if (!/^skills\/[a-zA-Z0-9_-]+\.md$/.test(filePath)) {
    throw new Error('Caminho de skill invalido.')
  }
  if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('Markdown maior que 2 MB.')
  const canonicalRoot = await fs.realpath(root)
  const destination = join(canonicalRoot, filePath)
  const directory = await fs.realpath(dirname(destination))
  const relativeDirectory = relative(canonicalRoot, directory)
  if (!relativeDirectory || relativeDirectory.startsWith(`..${sep}`) || isAbsolute(relativeDirectory)) {
    throw new Error('Diretorio da skill fora do cofre.')
  }
  try {
    await readContained(canonicalRoot, destination)
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  const temporary = join(directory, `.${basename(destination)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' })
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export async function saveVaultData(root: string, data: VaultData): Promise<void> {
  validateVault(data.catalog, data.projects)
  const canonicalRoot = await fs.realpath(root)
  const metadata = join(canonicalRoot, '.skillvortex')
  const values = [
    [join(metadata, 'catalogo.json'), JSON.stringify(data.catalog, null, 2)],
    [join(metadata, 'projetos.json'), JSON.stringify(data.projects, null, 2)]
  ] as const
  const id = randomUUID()
  const temporaries = values.map(([file]) => `${file}.${id}.tmp`)
  const backups = values.map(([file]) => `${file}.${id}.bak`)
  let backedUp = 0
  let published = 0
  let rollbackComplete = true
  const rollbackErrors: unknown[] = []
  try {
    for (let index = 0; index < values.length; index++) {
      await fs.writeFile(temporaries[index], values[index][1], { flag: 'wx' })
    }
    for (let index = 0; index < values.length; index++) {
      await fs.rename(values[index][0], backups[index])
      backedUp++
    }
    for (let index = 0; index < values.length; index++) {
      await fs.rename(temporaries[index], values[index][0])
      published++
    }
  } catch (error) {
    for (let index = published - 1; index >= 0; index--) {
      try {
        await fs.rm(values[index][0], { force: true })
      } catch (rollbackError) {
        rollbackComplete = false
        rollbackErrors.push(rollbackError)
      }
    }
    for (let index = backedUp - 1; index >= 0; index--) {
      try {
        await fs.rename(backups[index], values[index][0])
      } catch (rollbackError) {
        rollbackComplete = false
        rollbackErrors.push(rollbackError)
      }
    }
    if (!rollbackComplete) {
      throw new AggregateError([error, ...rollbackErrors], 'Falha ao salvar e restaurar os metadados do cofre.')
    }
    throw error
  } finally {
    await Promise.all(temporaries.map(file => fs.rm(file, { force: true })))
    if (rollbackComplete) await Promise.all(backups.map(file => fs.rm(file, { force: true })))
  }
}

// Publish metadata last so readers never load a partially imported vault.
export async function createVault(
  destination: string,
  data: VaultData = emptyVault(),
  contents: Map<string, string> = new Map()
): Promise<void> {
  validateVault(data.catalog, data.projects)
  const staging = join(destination, `.pending-${randomUUID()}`)
  try {
    await fs.mkdir(destination)
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new Error('Escolha um nome de cofre que ainda nao exista. Nada foi sobrescrito.')
    }
    throw error
  }
  try {
    await fs.mkdir(join(staging, 'skills'), { recursive: true })
    await fs.mkdir(join(staging, '.skillvortex/backups'), { recursive: true })
    for (const item of data.catalog.skills) {
      const content = contents.get(item.id)
      if (content === undefined) throw new Error(`Conteudo ausente: ${item.name}`)
      await fs.writeFile(join(staging, item.filePath), content, { flag: 'wx' })
    }
    await fs.writeFile(join(staging, '.skillvortex/catalogo.json'), JSON.stringify(data.catalog, null, 2))
    await fs.writeFile(join(staging, '.skillvortex/projetos.json'), JSON.stringify(data.projects, null, 2))
    await fs.rename(join(staging, 'skills'), join(destination, 'skills'))
    await fs.rename(join(staging, '.skillvortex'), join(destination, '.skillvortex'))
    await fs.rmdir(staging)
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true })
    throw error
  }
}
