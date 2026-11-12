import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { isProjectMarkdown, projectMarkdownAgent, readProjectMarkdown, scanProjectMarkdown } from '../src/project-scan'

let temporary: string
let project: string

beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-project-scan-'))
  project = join(temporary, 'project')
  await fs.mkdir(project)
})

afterEach(async () => {
  await fs.rm(temporary, { recursive: true, force: true })
})

test('finds custom Markdown names only in agent skill folders', async () => {
  const canonicalProject = await fs.realpath(project)
  const candidates = [
    '.github/skills/1-skill-de-teste.md',
    '.github/skills/exemplo/ANALISE-SEO.md',
    '.github/skills/exemplo/SKILL.md',
    '.github/skills/exemplo/setup-database.md',
    '.github/skills/exemplo/nested/other.MD',
    '.github/skills/pasta/teste-pasta/11-teste-de-carga.md',
    '.agents/skills/exemplo/SKILL.md',
    '.agents/skills/exemplo/1-skill-de-teste.md',
    '.agent/SKILLS/exemplo/ANALISE-SEO.md'
  ]
  const ignored = [
    'README.md', 'AGENTS.md', 'GEMINI.md', 'docs/guide.md', 'skills/SKILL.md',
    '.github/copilot-instructions.md', '.github/prompts/review.prompt.md',
    '.agent/workflows/deploy.md', '.vscode/notes.md', '.git/SKILL.md',
    'nested/.github/skills/x/SKILL.md', '.github/skills/exemplo/notes.txt',
    '.github/skills/exemplo/README.md', '.github/skills/exemplo/readme.pt-BR.MD',
    '.github/skills/exemplo/CONTRIBUTING.md', '.github/skills/exemplo/CHANGELOG.en.md',
    '.github/skills/exemplo/CODE_OF_CONDUCT.md', '.github/skills/exemplo/LICENSE.md',
    '.github/skills/exemplo/SECURITY.md', '.github/skills/exemplo/SECURITY.en.md',
    '.github/skills/exemplo/CONFIG.md', '.github/skills/exemplo/CONFIG.example.md',
    '.github/skills/exemplo/CONFIGURACAO.md', '.github/skills/exemplo/settings.md',
    '.github/skills/exemplo/EXAMPLES.md', '.github/skills/exemplo/QUICKSTART.md',
    '.github/skills/exemplo/example.instructions.md',
    '.github/skills/exemplo/example.prompt.MD', '.github/skills/exemplo/example.agent.md',
    '.github/skills/exemplo/docs/ANALISE-SEO.md',
    '.github/skills/exemplo/assets/SKILL.md',
    '.github/skills/exemplo/.config/app.md',
    '.github/skills/exemplo/node_modules/pkg/SKILL.md',
    '.agents/skills/exemplo/references/REFERENCE-GUIDE.md',
    '.agent/SKILLS/exemplo/examples/other.md'
  ]
  for (const file of [...candidates, ...ignored]) {
    const destination = join(canonicalProject, file)
    await fs.mkdir(dirname(destination), { recursive: true })
    await fs.writeFile(destination, '# Conteudo')
  }

  const expected = candidates.map(file => join(canonicalProject, file))
    .sort((left, right) => left.localeCompare(right))
  expect(await scanProjectMarkdown(project)).toEqual(expected)
  expect(await readProjectMarkdown(project, join(canonicalProject, candidates[1]))).toBe('# Conteudo')
  await expect(readProjectMarkdown(project, join(project, 'docs/guide.md'))).rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, '.github/copilot-instructions.md')))
    .rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, '.github/skills/exemplo/CONTRIBUTING.md')))
    .rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, '.github/skills/exemplo/docs/ANALISE-SEO.md')))
    .rejects.toThrow('dentro do projeto')
  expect(projectMarkdownAgent('.github/skills/html/SKILL.md')).toBe('Copilot')
  expect(projectMarkdownAgent('.agents/skills/html/SKILL.md')).toBe('Antigravity')
  expect(projectMarkdownAgent('.agent/SKILLS/exemplo/ANALISE-SEO.md')).toBe('Antigravity')
  expect(projectMarkdownAgent('.agent/rules/style.md')).toBeUndefined()
  expect(projectMarkdownAgent('.github/skills/exemplo/docs/ANALISE-SEO.md')).toBeUndefined()
  expect(projectMarkdownAgent('.github/skills/exemplo/README.md')).toBeUndefined()
  expect(projectMarkdownAgent('AGENTS.md')).toBeUndefined()
  expect(projectMarkdownAgent('docs/guide.md')).toBeUndefined()
})

test('scans multiple roots and deduplicates the same physical agent folder', async () => {
  const firstRoot = await fs.realpath(project)
  const secondRoot = join(temporary, 'workspace-with-spaces')
  await fs.mkdir(join(secondRoot, '.agents', 'skills', 'html'), { recursive: true })
  await fs.mkdir(join(secondRoot, '.github', 'skills', 'seo'), { recursive: true })
  const canonicalSecondRoot = await fs.realpath(secondRoot)
  const firstFile = join(firstRoot, '.github', 'skills', 'html', 'SKILL.md')
  const sharedFile = join(canonicalSecondRoot, '.agents', 'skills', 'html', 'ANALISE-SEO.md')
  const secondFile = join(canonicalSecondRoot, '.github', 'skills', 'seo', '1-skill-de-teste.md')
  await fs.mkdir(join(firstFile, '..'), { recursive: true })
  await fs.writeFile(firstFile, '# Primeira raiz')
  await fs.writeFile(sharedFile, '# Segunda raiz')
  await fs.writeFile(secondFile, '# Segunda skill')

  const files = await scanProjectMarkdown([firstRoot, canonicalSecondRoot, secondRoot])
  expect(files).toEqual([firstFile, secondFile, sharedFile].sort((a, b) => a.localeCompare(b)))
  expect(await readProjectMarkdown([firstRoot, secondRoot], sharedFile)).toBe('# Segunda raiz')
  await expect(readProjectMarkdown(firstRoot, sharedFile)).rejects.toThrow('dentro do projeto')
})

test('does not follow symbolic links and validates selected files and size', async () => {
  project = await fs.realpath(project)
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'external.md'), '# External')
  const skillDirectory = join(project, '.github', 'skills')
  await fs.mkdir(skillDirectory, { recursive: true })
  await fs.symlink(outside, join(skillDirectory, 'linked'))
  await fs.symlink(outside, join(project, '.agents'))
  await fs.mkdir(join(project, '.agent'))
  await fs.symlink(outside, join(project, '.agent', 'skills'))
  await fs.symlink(join(outside, 'external.md'), join(skillDirectory, 'external.md'))
  const skill = join(skillDirectory, 'skill.md')
  await fs.writeFile(skill, '# Local')

  expect(await scanProjectMarkdown(project)).toEqual([skill])
  expect(await readProjectMarkdown(project, skill)).toBe('# Local')
  await expect(readProjectMarkdown(project, join(outside, 'external.md'))).rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(skillDirectory, 'linked', 'external.md')))
    .rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, 'README.md'))).rejects.toThrow('dentro do projeto')
  await fs.writeFile(skill, 'x'.repeat(2 * 1024 * 1024 + 1))
  await expect(readProjectMarkdown(project, skill)).rejects.toThrow('ate 2 MB')
})

test('enforces the result limit', async () => {
  const manyFiles = join(project, '.github', 'skills', 'many')
  await fs.mkdir(manyFiles, { recursive: true })
  await Promise.all(Array.from({ length: 1000 }, (_, index) =>
    fs.writeFile(join(manyFiles, `skill-${index}.md`), '')
  ))
  expect(await scanProjectMarkdown(project)).toHaveLength(1000)
  await fs.writeFile(join(manyFiles, 'skill-1000.md'), '')
  await expect(scanProjectMarkdown(project)).rejects.toThrow('limite de 1.000')
})

test('enforces the visited entry limit', async () => {
  const manyEntries = join(project, '.agents', 'skills', 'entries')
  await fs.mkdir(manyEntries, { recursive: true })
  for (let start = 0; start < 49998; start += 1000) {
    await Promise.all(Array.from({ length: Math.min(1000, 49998 - start) }, (_, index) =>
      fs.writeFile(join(manyEntries, `file-${start + index}`), '')
    ))
  }
  expect(await scanProjectMarkdown(project)).toEqual([])
  await fs.writeFile(join(manyEntries, 'file-49998'), '')
  await expect(scanProjectMarkdown(project)).rejects.toThrow('50.000 entradas')
})

test('recognizes custom Markdown names while excluding conventional documentation', () => {
  for (const file of ['1-skill-de-teste.md', 'ANALISE-SEO.md', 'setup-database.MD', 'SKILL.md']) {
    expect(isProjectMarkdown(file)).toBe(true)
  }
  for (const file of [
    'README.md', 'readme.MD', 'README.pt-BR.md', 'CONTRIBUTING.md', 'CHANGELOG.en.md',
    'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SECURITY.en.md', 'CONFIG.example.md',
    'CONFIGURAÇÃO.md', '.config.md', 'EXAMPLES.md', 'QUICKSTART.md',
    'review.instructions.md', 'review.prompt.md', 'custom.agent.md'
  ]) {
    expect(isProjectMarkdown(file)).toBe(false)
  }
  expect(isProjectMarkdown('notes.txt')).toBe(false)
})
