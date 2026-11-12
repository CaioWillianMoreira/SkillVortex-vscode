import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'

const ignoredDirectories = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'out', 'build', 'release',
  '.next', '.venv', 'venv', 'coverage',
  'doc', 'docs', 'documentation', 'documentacao', 'documents', 'documentos',
  'reference', 'references', 'referencia', 'referencias',
  'examples', 'samples', 'assets', 'templates',
  '.config', 'config', 'configs', 'configuration', 'configurations',
  'configuracao', 'configuracoes'
])

export const agentDirectories = [
  { directory: '.github', agent: 'Copilot' },
  { directory: '.agents', agent: 'Antigravity' },
  { directory: '.claude', agent: 'Claude' },
  { directory: '.copilot', agent: 'Copilot' }
] as const

export function skillDirectoriesForRoot(root: string, home: string) {
  return agentDirectories.filter(item => root === home
    ? item.directory === '.copilot' || item.directory === '.claude'
    : item.directory !== '.copilot')
}

const ignoredMarkdownNames = new Set([
  'agents', 'authors', 'changes', 'claude', 'codeowners', 'config', 'configs', 'configuration',
  'configuracao', 'configuracoes', 'contributors', 'copilot-instructions',
  'copying', 'docs', 'documentation', 'documentacao', 'example', 'examples', 'faq',
  'gemini', 'governance', 'guide', 'guidelines', 'history', 'install', 'installation',
  'instalacao', 'maintainers', 'notice', 'owners', 'quickstart', 'reference',
  'references', 'release-notes', 'release_notes', 'security', 'settings', 'setup',
  'support', 'troubleshooting', 'tutorial', 'usage', 'issue_template', 'pull_request_template'
])
const ignoredMarkdownPrefixes = [
  'readme', 'contributing', 'changelog', 'license', 'licence',
  'code-of-conduct', 'code_of_conduct'
]
const ignoredMarkdownSuffixes = ['.instructions', '.prompt', '.agent', '.chatmode', '.config']

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function isProjectMarkdown(filePath: string): boolean {
  const name = normalizedName(filePath.split(/[\\/]/).pop() ?? '')
  if (!name.endsWith('.md')) return false
  const stem = name.slice(0, -3).replace(/^\./, '')
  return !ignoredMarkdownNames.has(stem.split('.')[0]) &&
    !ignoredMarkdownPrefixes.some(prefix =>
      stem === prefix || ['.', '-', '_'].some(separator => stem.startsWith(`${prefix}${separator}`))) &&
    !ignoredMarkdownSuffixes.some(suffix => stem.endsWith(suffix))
}

export function projectMarkdownAgent(relativePath: string): string | undefined {
  const [directory, skills, ...parts] = relativePath.split(/[\\/]/)
  const agent = agentDirectories.find(item => item.directory === normalizedName(directory ?? ''))
  if (!agent || normalizedName(skills ?? '') !== 'skills' || !parts.length ||
      !isProjectMarkdown(parts[parts.length - 1]) ||
      parts.slice(0, -1).some(part =>
        !part || part === '.' || part === '..' || ignoredDirectories.has(normalizedName(part)))) {
    return undefined
  }
  return agent.agent
}

export async function scanProjectMarkdown(rootPaths: string | readonly string[]): Promise<string[]> {
  const roots = [...new Set(await Promise.all(
    (typeof rootPaths === 'string' ? [rootPaths] : rootPaths).map(async path => {
      const root = await fs.realpath(path)
      if (!(await fs.stat(root)).isDirectory()) throw new Error(`O projeto nao e uma pasta: ${path}`)
      return root
    })
  ))]
  const files: string[] = []
  const home = await fs.realpath(homedir())
  const visitedFiles = new Set<string>()
  let entriesVisited = 0

  function countEntry(): void {
    if (++entriesVisited > 50000) {
      throw new Error('O projeto ultrapassou o limite de 50.000 entradas na varredura.')
    }
  }

  async function visit(root: string, directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      countEntry()
      if (entry.isSymbolicLink()) continue
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(normalizedName(entry.name))) await visit(root, file)
      } else if (entry.isFile() && projectMarkdownAgent(relative(root, file))) {
        const canonicalFile = await fs.realpath(file)
        if (visitedFiles.has(canonicalFile)) continue
        if (files.length >= 1000) throw new Error('A busca ultrapassou o limite de 1.000 arquivos Markdown.')
        visitedFiles.add(canonicalFile)
        files.push(canonicalFile)
      }
    }
  }

  for (const root of roots) {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() ||
          !skillDirectoriesForRoot(root, home).some(item => item.directory === entry.name.toLowerCase())) continue
      const agentRoot = join(root, entry.name)
      for (const child of await fs.readdir(agentRoot, { withFileTypes: true })) {
        countEntry()
        if (child.isDirectory() && normalizedName(child.name) === 'skills') {
          await visit(root, join(agentRoot, child.name))
        }
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

export async function readProjectMarkdown(rootPaths: string | readonly string[], filePath: string): Promise<string> {
  if (!isProjectMarkdown(filePath)) {
    throw new Error('O arquivo selecionado nao e Markdown dentro do projeto.')
  }
  const canonicalFile = await fs.realpath(filePath)
  const home = await fs.realpath(homedir())
  const paths = typeof rootPaths === 'string' ? [rootPaths] : rootPaths
  let contained = false
  for (const rootPath of paths) {
    const root = await fs.realpath(rootPath)
    const path = relative(root, canonicalFile)
    if (path && !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`) &&
        skillDirectoriesForRoot(root, home).some(item => item.directory === path.split(sep)[0].toLowerCase()) &&
        projectMarkdownAgent(path)) {
      contained = true
      break
    }
  }
  if (!contained) {
    throw new Error('O arquivo selecionado nao e Markdown dentro do projeto.')
  }
  const stat = await fs.stat(canonicalFile)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
    throw new Error('O Markdown deve ser um arquivo de ate 2 MB.')
  }
  return fs.readFile(canonicalFile, 'utf8')
}
