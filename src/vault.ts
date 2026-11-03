import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute, sep } from 'node:path'
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
