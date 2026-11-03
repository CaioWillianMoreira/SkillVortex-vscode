import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

const ignoredDirectories = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'out', 'build', 'release',
  '.next', '.venv', 'venv', 'coverage'
])

export function isProjectMarkdown(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? ''
  return name.endsWith('.md') && name !== 'readme.md'
}

export async function scanProjectMarkdown(rootPath: string): Promise<string[]> {
  const root = await fs.realpath(rootPath)
  if (!(await fs.stat(root)).isDirectory()) throw new Error('O projeto nao e uma pasta.')
  const files: string[] = []
  let entriesVisited = 0

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (++entriesVisited > 50000) {
        throw new Error('O projeto ultrapassou o limite de 50.000 entradas na varredura.')
      }
      if (entry.isSymbolicLink()) continue
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLocaleLowerCase())) await visit(file)
      } else if (entry.isFile() && isProjectMarkdown(entry.name)) {
        if (files.length >= 1000) throw new Error('A busca ultrapassou o limite de 1.000 arquivos Markdown.')
        files.push(file)
      }
    }
  }

  await visit(root)
  return files.sort((left, right) => left.localeCompare(right))
}

export async function readProjectMarkdown(rootPath: string, filePath: string): Promise<string> {
  if (!isProjectMarkdown(filePath)) {
    throw new Error('O arquivo selecionado nao e Markdown dentro do projeto.')
  }
  const root = await fs.realpath(rootPath)
  const canonicalFile = await fs.realpath(filePath)
  const path = relative(root, canonicalFile)
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) || !isProjectMarkdown(path)) {
    throw new Error('O arquivo selecionado nao e Markdown dentro do projeto.')
  }
  const stat = await fs.stat(canonicalFile)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
    throw new Error('O Markdown deve ser um arquivo de ate 2 MB.')
  }
  return fs.readFile(canonicalFile, 'utf8')
}
