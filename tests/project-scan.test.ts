import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { isProjectMarkdown, readProjectMarkdown, scanProjectMarkdown } from '../src/project-scan'

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

test('recursively finds Markdown and excludes README and generated directories', async () => {
  const canonicalProject = await fs.realpath(project)
  const expected = [
    join(canonicalProject, 'AGENTS.md'),
    join(canonicalProject, 'docs/guide.MD'),
    join(canonicalProject, 'skills/SKILL.md')
  ]
  for (const file of expected) {
    await fs.mkdir(join(file, '..'), { recursive: true })
    await fs.writeFile(file, '# Skill')
  }
  for (const file of [
    'README.md', 'docs/ReadMe.Md', 'node_modules/pkg/SKILL.md',
    '.git/SKILL.md', 'dist/SKILL.md', 'coverage/SKILL.md', 'notes.txt'
  ]) {
    const destination = join(project, file)
    await fs.mkdir(join(destination, '..'), { recursive: true })
    await fs.writeFile(destination, '# Ignored')
  }

  expect(await scanProjectMarkdown(project)).toEqual(expected)
})

test('does not follow symbolic links and validates selected files and size', async () => {
  project = await fs.realpath(project)
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'external.md'), '# External')
  await fs.symlink(outside, join(project, 'linked'))
  const skill = join(project, 'skill.md')
  await fs.writeFile(skill, '# Local')

  expect(await scanProjectMarkdown(project)).toEqual([skill])
  expect(await readProjectMarkdown(project, skill)).toBe('# Local')
  await expect(readProjectMarkdown(project, join(outside, 'external.md'))).rejects.toThrow('dentro do projeto')
  await expect(readProjectMarkdown(project, join(project, 'README.md'))).rejects.toThrow('dentro do projeto')
  await fs.writeFile(skill, 'x'.repeat(2 * 1024 * 1024 + 1))
  await expect(readProjectMarkdown(project, skill)).rejects.toThrow('ate 2 MB')
})

test('enforces the result limit', async () => {
  const manyFiles = join(project, 'many')
  await fs.mkdir(manyFiles)
  await Promise.all(Array.from({ length: 1001 }, (_, index) =>
    fs.writeFile(join(manyFiles, `skill-${index}.md`), '')
  ))
  await expect(scanProjectMarkdown(project)).rejects.toThrow('limite de 1.000')
})

test('recognizes Markdown case-insensitively but excludes README names', () => {
  expect(isProjectMarkdown('nested/guide.MD')).toBe(true)
  expect(isProjectMarkdown('nested/README.md')).toBe(false)
  expect(isProjectMarkdown('nested/readme.MD')).toBe(false)
  expect(isProjectMarkdown('notes.txt')).toBe(false)
})
