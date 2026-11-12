import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { chooseMarkdownFiles } from '../src/markdown-picker'

jest.mock('vscode', () => ({
  window: { showQuickPick: jest.fn(), showInputBox: jest.fn() }
}), { virtual: true })

type Choice = { label: string; action?: string; path?: string }
const { window }: {
  window: {
    showQuickPick: ReturnType<typeof jest.fn<(items: Choice[], options: { canPickMany?: boolean }) => Promise<Choice | Choice[] | undefined>>>
    showInputBox: ReturnType<typeof jest.fn<() => Promise<string | undefined>>>
  }
} = require('vscode')
let root: string

beforeEach(async () => {
  jest.resetAllMocks()
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'markdown-picker-')))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

test('shows only agent folders at the root and navigates their subfolders to select Markdown', async () => {
  for (const agent of ['.github', '.agents', '.agent', '.copilot', '.claude', '.cursor', '.codex']) {
    await fs.mkdir(join(root, agent, 'skills', 'teste-pasta'), { recursive: true })
  }
  for (const other of ['src', 'docs', '.git', '.vscode', 'node_modules', '.custom-hidden']) {
    await fs.mkdir(join(root, other))
  }
  const folder = join(root, '.github', 'skills', 'teste-pasta')
  const files = ['11-teste-de-carga.md', 'Outra.MD']
  for (const file of files) await fs.writeFile(join(folder, file), '# Original')
  await fs.writeFile(join(folder, 'not-markdown.txt'), 'Not a skill')

  window.showQuickPick
    .mockImplementationOnce(async items => {
      expect(items.map(item => item.label)).toEqual(expect.arrayContaining([
        '$(folder) .github', '$(folder) .agents', '$(folder) .agent',
        '$(folder) .copilot', '$(folder) .claude', '$(folder) .cursor', '$(folder) .codex'
      ]))
      expect(items.filter(item => item.label.startsWith('$(folder)')).map(item => item.label)).toHaveLength(7)
      return items.find(item => item.path === join(root, '.github'))
    })
    .mockImplementationOnce(async items => items.find(item => item.path === join(root, '.github', 'skills')))
    .mockImplementationOnce(async items => items.find(item => item.path === folder))
    .mockImplementationOnce(async items => items.find(item => item.action === 'files'))
    .mockImplementationOnce(async (items, options) => {
      expect(options.canPickMany).toBe(true)
      expect(items.map(item => item.label)).toEqual(files)
      return items
    })

  expect(await chooseMarkdownFiles(root)).toEqual(files.map(file => join(folder, file)))
  for (const file of files) expect(await fs.readFile(join(folder, file), 'utf8')).toBe('# Original')
})

test('navigates to another path and back to the parent while displaying hidden folders', async () => {
  const hidden = join(root, '.agents')
  await fs.mkdir(hidden)
  await fs.writeFile(join(root, 'rule.md'), '# Rule')
  window.showInputBox.mockResolvedValueOnce(hidden)
  window.showQuickPick
    .mockImplementationOnce(async items => items.find(item => item.action === 'path'))
    .mockImplementationOnce(async items => items.find(item => item.path === root))
    .mockImplementationOnce(async items => items.find(item => item.action === 'files'))
    .mockImplementationOnce(async items => items)

  expect(await chooseMarkdownFiles(root)).toEqual([join(root, 'rule.md')])
})

test('cancelling file selection returns to folder navigation and cancelling navigation makes no changes', async () => {
  await fs.writeFile(join(root, 'rule.md'), '# Rule')
  window.showQuickPick
    .mockImplementationOnce(async items => items.find(item => item.action === 'files'))
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(async items => {
      expect(items.some(item => item.action === 'files')).toBe(true)
      return undefined
    })

  expect(await chooseMarkdownFiles(root)).toBeUndefined()
  expect(await fs.readFile(join(root, 'rule.md'), 'utf8')).toBe('# Rule')
})
