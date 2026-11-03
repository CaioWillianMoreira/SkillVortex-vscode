import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('finds Markdown only in Copilot and Antigravity agent folders', async () => {
  const canonicalProject = await fs.realpath(project)
  const expected = [
    join(canonicalProject, '.agent/workflows/deploy.md'),
    join(canonicalProject, '.agents/skills/html/SKILL.md'),
    join(canonicalProject, '.github/copilot-instructions.md'),
    join(canonicalProject, '.github/prompts/review.prompt.MD'),
    join(canonicalProject, '.github/skills/html/SKILL.md'),
    join(canonicalProject, 'AGENTS.md'),
    join(canonicalProject, 'GEMINI.md')
  ]
  for (const file of expected) {
    await fs.mkdir(join(file, '..'), { recursive: true })
    await fs.writeFile(file, '# Skill')
  }
  for (const file of [
    'README.md', 'docs/guide.md', 'skills/SKILL.md', '.vscode/notes.md',
    '.github/README.md', '.github/node_modules/pkg/SKILL.md', '.git/SKILL.md',
    'nested/.github/skills/x/SKILL.md', '.github/notes.txt'
  ]) {
    const destination = join(project, file)
    await fs.mkdir(join(destination, '..'), { recursive: true })
    await fs.writeFile(destination, '# Ignored')
  }

  expect(await scanProjectMarkdown(project)).toEqual(expected)
  expect(await readProjectMarkdown(project, expected[1])).toBe('# Skill')
  await expect(readProjectMarkdown(project, join(project, 'docs/guide.md'))).rejects.toThrow('dentro do projeto')
  expect(projectMarkdownAgent('.github/skills/html/SKILL.md')).toBe('Copilot')
  expect(projectMarkdownAgent('.agents/skills/html/SKILL.md')).toBe('Antigravity')
  expect(projectMarkdownAgent('.agent/rules/style.md')).toBe('Antigravity')
  expect(projectMarkdownAgent('docs/guide.md')).toBeUndefined()
})

test('does not follow symbolic links and validates selected files and size', async () => {
  project = await fs.realpath(project)
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'external.md'), '# External')
  await fs.mkdir(join(project, '.github'))
  await fs.symlink(outside, join(project, '.github', 'linked'))
  await fs.symlink(outside, join(project, '.agents'))
  const skill = join(project, '.github', 'skill.md')
  await fs.writeFile(skill, '# Local')

  expect(await scanProjectMarkdown(project)).toEqual([skill])
  expect(await readProjectMarkdown(project, skill)).toBe('# Local')
  await expect(readProjectMarkdown(project, join(outside, 'external.md'))).rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, 'README.md'))).rejects.toThrow('dentro do projeto')
  await fs.writeFile(skill, 'x'.repeat(2 * 1024 * 1024 + 1))
  await expect(readProjectMarkdown(project, skill)).rejects.toThrow('ate 2 MB')
})

test('enforces the result limit', async () => {
  const manyFiles = join(project, '.github', 'many')
  await fs.mkdir(manyFiles, { recursive: true })
  await Promise.all(Array.from({ length: 1001 }, (_, index) =>
    fs.writeFile(join(manyFiles, `skill-${index}.md`), '')
  ))
  await expect(scanProjectMarkdown(project)).rejects.toThrow('limite de 1.000')
})

test('enforces the visited entry limit', async () => {
  const manyEntries = join(project, '.agents', 'entries')
  await fs.mkdir(manyEntries, { recursive: true })
  for (let start = 0; start < 50001; start += 1000) {
    await Promise.all(Array.from({ length: Math.min(1000, 50001 - start) }, (_, index) =>
      fs.writeFile(join(manyEntries, `file-${start + index}`), '')
    ))
  }
  await expect(scanProjectMarkdown(project)).rejects.toThrow('50.000 entradas')
})

test('recognizes Markdown case-insensitively but excludes README names', () => {
  expect(isProjectMarkdown('nested/guide.MD')).toBe(true)
  expect(isProjectMarkdown('nested/README.md')).toBe(false)
  expect(isProjectMarkdown('nested/readme.MD')).toBe(false)
  expect(isProjectMarkdown('notes.txt')).toBe(false)
})
