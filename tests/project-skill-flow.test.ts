import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { Uri, type ExtensionContext } from 'vscode'
import { activate } from '../src/extension'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'
import { createDocumentedExamples } from '../src/documented-examples'

jest.mock('../src/database', () => ({
  initializeSql: jest.fn(async () => ({})),
  rebuildIndex: jest.fn(async () => {})
}))
jest.mock('vscode', () => {
  let receive: (message: unknown) => Promise<void>
  const commands = new Map<string, () => Promise<void>>()
  const executeCommand = jest.fn(async () => undefined)
  const disposable = { dispose() {} }
  const postMessage = jest.fn(async () => true)
  const errors = jest.fn()
  const dialog = jest.fn()
  const workspace = { isTrusted: true, workspaceFolders: [] }
  const uri = (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path })
  return {
    workspace,
    env: {},
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { One: 1 },
    Uri: { file: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(join(base.fsPath, ...parts)) },
    commands: {
      registerCommand: (name: string, action: () => Promise<void>) => {
        commands.set(name, action)
        return disposable
      },
      executeCommand
    },
    window: {
      createOutputChannel: () => ({ ...disposable, appendLine() {} }),
      createStatusBarItem: () => ({ ...disposable, show() {} }),
      showErrorMessage: errors,
      showInformationMessage: jest.fn(),
      showOpenDialog: dialog,
      createWebviewPanel: () => ({
        onDidDispose: () => disposable,
        webview: {
          asWebviewUri: (value: unknown) => value,
          postMessage,
          onDidReceiveMessage: (handler: typeof receive) => { receive = handler; return disposable }
        }
      })
    },
    testing: { commands, executeCommand, postMessage, errors, dialog, dispatch: (message: unknown) => receive(message) }
  }
}, { virtual: true })

const mock: {
  workspace: { workspaceFolders: Array<{ uri: { fsPath: string; scheme: string } }> }
  testing: {
    commands: Map<string, () => Promise<void>>
    executeCommand: ReturnType<typeof jest.fn>
    errors: ReturnType<typeof jest.fn>
    dialog: ReturnType<typeof jest.fn>
    postMessage: ReturnType<typeof jest.fn>
    dispatch: (message: unknown) => Promise<void>
  }
} = require('vscode')
let temporary: string
let root: string
let projectPath: string
let context: ExtensionContext
let skillId: string

beforeEach(async () => {
  jest.clearAllMocks()
  temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-button-'))
  root = join(temporary, 'vault')
  projectPath = join(temporary, 'project')
  await fs.mkdir(projectPath)
  await createVault(root)
  const data = await readVault(root)
  const example = createDocumentedExamples()[7]
  example.skill.category = 'Geral'
  skillId = example.skill.id
  data.catalog.skills.push(example.skill)
  await writeSkillFile(root, example.skill.filePath, example.content)
  await saveVaultData(root, data)
  mock.workspace.workspaceFolders = [{ uri: { fsPath: projectPath, scheme: 'file' } }]
  const stub: Partial<ExtensionContext> = {
    subscriptions: [],
    asAbsolutePath: (path: string) => join(temporary, path),
    extensionUri: Uri.file(temporary),
    globalStorageUri: Uri.file(join(temporary, 'index')),
    globalState: {
      get: <T>(key: string, defaultValue?: T): T => (key === 'vaultPath' ? root : defaultValue) as T,
      update: async () => {},
      keys: () => ['vaultPath'],
      setKeysForSync: () => {}
    }
  }
  context = stub as ExtensionContext
  activate(context)
  await mock.testing.commands.get('skillVortex.open')!()
})
afterEach(async () => {
  for (const subscription of context.subscriptions) subscription.dispose()
  await fs.rm(temporary, { recursive: true, force: true })
})

test('the existing toggle message creates a workspace project, publishes, disables and restores', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const enabled = await readVault(root)
  expect(enabled.projects.projects).toHaveLength(1)
  const project = enabled.projects.projects[0]
  expect(project.sourcePath).toBe(await fs.realpath(projectPath))
  expect(enabled.projects.activeProject).toBe(project.id)
  expect(project.skillIds).toEqual([skillId])
  const file = join(projectPath, '.github/skills', project.deployedSkills![0].directory, 'SKILL.md')
  expect(await fs.readFile(file, 'utf8')).toContain('Testes Unitários com Vitest')
  await fs.appendFile(file, '\nEdicao no projeto')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  expect(await fs.readFile(file, 'utf8')).toContain('Edicao no projeto')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('run skill opens Copilot chat with the published slash command without sending it', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const project = (await readVault(root)).projects.projects[0]
  const directory = project.deployedSkills![0].directory

  await mock.testing.dispatch({ type: 'runSkill', id: skillId })

  expect(mock.testing.executeCommand).toHaveBeenCalledWith('workbench.action.chat.open', {
    query: `/${directory} `,
    isPartialQuery: true
  })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('run skill requires its project folder to be open in the workspace', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  mock.workspace.workspaceFolders = []

  await mock.testing.dispatch({ type: 'runSkill', id: skillId })

  expect(mock.testing.executeCommand).not.toHaveBeenCalled()
  expect(mock.testing.errors).toHaveBeenCalledWith(
    'SkillVortex: Abra no VS Code a pasta associada ao projeto antes de executar a skill.'
  )
})

test('cancelling folder selection does not create a project or link', async () => {
  mock.workspace.workspaceFolders = []
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  expect(mock.testing.dialog).toHaveBeenCalled()
  expect((await readVault(root)).projects.projects).toEqual([])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('the save message reports a project conflict and restores the vault Markdown', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const data = await readVault(root)
  const project = data.projects.projects[0]
  const skill = data.catalog.skills[0]
  const file = join(projectPath, '.github/skills', project.deployedSkills![0].directory, 'SKILL.md')
  await fs.appendFile(file, '\nLocal edit')
  const originalContent = await fs.readFile(join(root, skill.filePath), 'utf8')
  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, content: '# Updated', projectIds: [project.id]
  })
  expect(mock.testing.errors).toHaveBeenCalled()
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toBe(originalContent)
  expect(await fs.readFile(file, 'utf8')).toContain('Local edit')
  expect(await readVault(root)).toEqual(data)
})
