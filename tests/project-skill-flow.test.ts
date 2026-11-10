import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { Uri, type ExtensionContext } from 'vscode'
import { activate } from '../src/extension'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'
import { createDocumentedExamples } from '../src/documented-examples'
import { SKILL_CARD_COLORS } from '../src/skill-colors'
import { isAgentLinked, skillCards } from '../src/model'
import { skillMarkdownMetadata } from '../src/project-skills'

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
  const information = jest.fn()
  const dialog = jest.fn()
  const warning = jest.fn(async (_message: string, _options: unknown, action: string) => action)
  const quickPick = jest.fn(async (items: Array<{ picked: boolean }>) => items.filter(item => item.picked))
  const fileListeners = new Set<() => void>()
  const workspace = { isTrusted: true, workspaceFolders: [],
    registerTextDocumentContentProvider: () => disposable,
    createFileSystemWatcher: () => ({ ...disposable,
      onDidChange: (listener: () => void) => {
        fileListeners.add(listener)
        return { dispose: () => fileListeners.delete(listener) }
      }, onDidCreate: () => disposable, onDidDelete: () => disposable }) }
  const uri = (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path })
  return {
    workspace,
    env: {},
    StatusBarAlignment: { Left: 1 },
    ViewColumn: { One: 1 },
    RelativePattern: class { constructor(public base: string, public pattern: string) {} },
    Uri: { file: uri, parse: uri, joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(join(base.fsPath, ...parts)) },
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
      showInformationMessage: information,
      showWarningMessage: warning,
      showOpenDialog: dialog,
      showQuickPick: quickPick,
      createWebviewPanel: () => ({
        onDidDispose: () => disposable,
        webview: {
          asWebviewUri: (value: unknown) => value,
          postMessage,
          onDidReceiveMessage: (handler: typeof receive) => { receive = handler; return disposable }
        }
      })
    },
    testing: { commands, executeCommand, postMessage, errors, information, dialog, warning, quickPick,
      fireFileChange: () => { for (const listener of fileListeners) listener() },
      dispatch: (message: unknown) => receive(message) }
  }
}, { virtual: true })

const mock: {
  workspace: { workspaceFolders: Array<{ uri: { fsPath: string; scheme: string } }> }
  testing: {
    commands: Map<string, () => Promise<void>>
    executeCommand: ReturnType<typeof jest.fn>
    errors: ReturnType<typeof jest.fn>
    information: ReturnType<typeof jest.fn>
    dialog: ReturnType<typeof jest.fn>
    warning: ReturnType<typeof jest.fn>
    quickPick: ReturnType<typeof jest.fn>
    postMessage: ReturnType<typeof jest.fn>
    dispatch: (message: unknown) => Promise<void>
    fireFileChange: () => void
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

function pendingDraft(): { skill: import('../src/model').Skill; content: string } {
  const state = mock.testing.postMessage.mock.calls.at(-1)![0] as {
    catalog: import('../src/model').Catalog; editingSkillId: string; content: string
  }
  return { skill: state.catalog.skills.find(item => item.id === state.editingSkillId)!, content: state.content }
}

test('leaving a new skill without saving persists neither card, Markdown nor membership', async () => {
  const before = await readVault(root)
  before.catalog.collections = [{ id: 'empty', name: 'Empty', category: 'Geral', skillIds: [] }]
  await saveVaultData(root, before)
  const files = await fs.readdir(join(root, 'skills'))
  await mock.testing.dispatch({ type: 'createSkill', collectionId: 'empty', cardColor: null })
  const draft = pendingDraft()
  expect(draft.skill).toBeDefined()
  expect(await readVault(root)).toEqual(before)
  await mock.testing.dispatch({ type: 'refresh' })
  expect(pendingDraft().skill.id).toBe(draft.skill.id)
  await mock.testing.dispatch({ type: 'backToDashboard' })
  expect(await readVault(root)).toEqual(before)
  expect(await fs.readdir(join(root, 'skills'))).toEqual(files)
  await mock.testing.dispatch({ type: 'saveSkill', ...draft.skill,
    content: draft.content, tags: ['test'], projectIds: [], cardColor: null })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('nao encontrada'))
})

test('opening an existing skill and leaving does not modify it', async () => {
  const before = await readVault(root)
  const content = await fs.readFile(join(root, before.catalog.skills[0].filePath))
  await mock.testing.dispatch({ type: 'openSkill', id: skillId })
  await mock.testing.dispatch({ type: 'backToDashboard' })
  expect(await readVault(root)).toEqual(before)
  expect(await fs.readFile(join(root, before.catalog.skills[0].filePath))).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('a failed first save removes its Markdown but keeps the draft for retry', async () => {
  const before = await readVault(root)
  before.projects.projects = [{ id: 'project', name: 'Project', sourcePath: projectPath, skillIds: [] }]
  await saveVaultData(root, before)
  const conflict = join(projectPath, '.agents/skills/new-rule/SKILL.md')
  await fs.mkdir(join(conflict, '..'), { recursive: true })
  await fs.writeFile(conflict, 'Conflicting file')
  await mock.testing.dispatch({ type: 'createSkill', cardColor: null })
  const { skill: draft, content } = pendingDraft()
  await mock.testing.dispatch({ type: 'saveSkill', ...draft, name: 'New rule',
    tags: ['test'], cardColor: null, content, projectIds: ['project'] })
  expect(mock.testing.errors).toHaveBeenCalled()
  expect(await readVault(root)).toEqual(before)
  await expect(fs.stat(join(root, 'skills/new-rule.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'saveSkill', ...draft, name: 'New rule',
    tags: ['test'], cardColor: null, content, projectIds: [] })
  expect((await readVault(root)).catalog.skills).toHaveLength(2)
})

test('the existing toggle message creates a workspace project, publishes, disables and restores', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const enabled = await readVault(root)
  expect(enabled.projects.projects).toHaveLength(1)
  const project = enabled.projects.projects[0]
  expect(project.sourcePath).toBe(await fs.realpath(projectPath))
  expect(enabled.projects.activeProject).toBe(project.id)
  expect(project.skillIds).toEqual([skillId])
  const file = join(projectPath, '.agents/skills', project.deployedSkills![0].directory, 'SKILL.md')
  expect(await fs.readFile(file, 'utf8')).toContain('Testes Unitários com Vitest')
  await fs.appendFile(file, '\nEdicao no projeto')
  const copilotFile = join(projectPath, '.github/skills', project.deployedSkills![0].directory, 'SKILL.md')
  await fs.writeFile(copilotFile, await fs.readFile(file))
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  expect(await fs.readFile(file, 'utf8')).toContain('Edicao no projeto')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('agent card actions isolate activation, unlinking and deletion while keeping shared content', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'Antigravity' })
  const agentsFile = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  const githubFile = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const agentsContent = await fs.readFile(agentsFile)
  await expect(fs.stat(githubFile)).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'GitHub Copilot' })
  await mock.testing.dispatch({ type: 'unlinkSkill', id: skillId, agent: 'GitHub Copilot' })
  const unlinked = await readVault(root)
  expect(unlinked.catalog.skills[0].agents).toEqual(['Antigravity'])
  expect(isAgentLinked(unlinked.projects.projects[0], skillId, 'Antigravity')).toBe(true)
  expect(isAgentLinked(unlinked.projects.projects[0], skillId, 'GitHub Copilot')).toBe(false)
  expect(await fs.readFile(agentsFile)).toEqual(agentsContent)
  expect(await fs.readFile(githubFile)).toEqual(agentsContent)
  expect(await fs.readFile(join(root, unlinked.catalog.skills[0].filePath), 'utf8')).toContain('Vitest')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('deleting one inactive agent preserves the other active agent and shared vault Markdown', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'GitHub Copilot' })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'Antigravity' })
  const agentsFile = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  const githubFolder = join(projectPath, '.github/skills/testes-unitarios-com-vitest')
  const githubFile = join(githubFolder, 'SKILL.md')
  await fs.writeFile(join(githubFolder, 'extra.txt'), 'Remove only for Copilot')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'GitHub Copilot' })
  const content = await fs.readFile(agentsFile)
  await mock.testing.dispatch({ type: 'deleteSkill', id: skillId, agent: 'GitHub Copilot' })
  const deleted = await readVault(root)
  expect(deleted.catalog.skills[0].agents).toEqual(['Antigravity'])
  expect(deleted.catalog.skills[0].publishedFolders!.every(folder => folder.agent === 'Antigravity')).toBe(true)
  expect(isAgentLinked(deleted.projects.projects[0], skillId, 'Antigravity')).toBe(true)
  expect(await fs.readFile(agentsFile)).toEqual(content)
  await expect(fs.stat(githubFolder)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(githubFile)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(join(root, deleted.catalog.skills[0].filePath), 'utf8')).toContain('Vitest')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('executing an Antigravity card never opens the Copilot chat', async () => {
  await mock.testing.dispatch({ type: 'runSkill', id: skillId, agent: 'Antigravity' })
  expect(mock.testing.executeCommand).not.toHaveBeenCalled()
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('somente para GitHub Copilot'))
})

test('a Copilot toggle never synchronizes or rewrites another agent deployment', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'Antigravity' })
  const agentsFile = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  const original = await fs.readFile(agentsFile)
  const active = await readVault(root)
  await writeSkillFile(root, active.catalog.skills[0].filePath, '# Updated shared source')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent: 'GitHub Copilot' })
  expect(await fs.readFile(agentsFile)).toEqual(original)
  expect(await fs.readFile(join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md'), 'utf8'))
    .toContain('# Updated shared source')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('saving a shared registration publishes identical standard folders for both agents', async () => {
  const data = await readVault(root)
  data.projects.projects.push({
    id: 'shared-project', name: 'Shared project', sourcePath: projectPath, skillIds: []
  })
  await saveVaultData(root, data)
  const skill = data.catalog.skills[0]
  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, agents: ['GitHub Copilot', 'Antigravity'],
    cardColor: null, content: '# Shared rule', projectIds: ['shared-project']
  })
  const saved = await readVault(root)
  expect(saved.catalog.skills).toHaveLength(1)
  expect(saved.projects.projects[0].agentBindings).toEqual([
    { skillId, agent: 'GitHub Copilot' }, { skillId, agent: 'Antigravity' }
  ])
  const agents = await fs.readFile(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md'))
  expect(await fs.readFile(join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md'))).toEqual(agents)
  expect(agents.toString()).toContain('# Shared rule')
  expect(await fs.readdir(join(root, 'skills'))).toEqual([saved.catalog.skills[0].filePath.slice('skills/'.length)])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('displayed agent controls change only that destination and keep one library Markdown', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  const copilot = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const antigravity = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['Antigravity'] })
  const content = await fs.readFile(antigravity)
  await expect(fs.stat(copilot)).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['GitHub Copilot'] })
  expect(await fs.readFile(copilot)).toEqual(content)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['Antigravity'] })
  await expect(fs.stat(antigravity)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(copilot)).toEqual(content)
  expect((await readVault(root)).projects.projects[0].agentBindings).toEqual([
    { skillId, agent: 'GitHub Copilot' }
  ])
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['Antigravity', 'GitHub Copilot'] })
  expect(await fs.readFile(antigravity)).toEqual(content)
  expect(await fs.readFile(copilot)).toEqual(content)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['Antigravity', 'GitHub Copilot'] })
  for (const file of [copilot, antigravity]) await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readVault(root)).catalog.skills).toHaveLength(1)
  expect(await fs.readdir(join(root, 'skills'))).toHaveLength(1)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('collection agent controls use card labels rather than member labels', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot']
  data.catalog.collections = [{
    id: 'targeted', name: 'Targeted', skillIds: [skillId], agents: ['Antigravity', 'GitHub Copilot']
  }]
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleCollection', id: 'targeted', enabled: true, agents: ['Antigravity'] })
  const file = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  const content = await fs.readFile(file)
  await expect(fs.stat(join(projectPath, '.github/skills'))).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'toggleCollection', id: 'targeted', enabled: true, agents: ['GitHub Copilot'] })
  await mock.testing.dispatch({ type: 'toggleCollection', id: 'targeted', enabled: false, agents: ['GitHub Copilot'] })
  expect(await fs.readFile(file)).toEqual(content)
  expect((await readVault(root)).projects.projects[0].agentBindings).toEqual([{ skillId, agent: 'Antigravity' }])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('cards with both agents can be disabled repeatedly without changing another active card', async () => {
  const data = await readVault(root)
  const second = { ...data.catalog.skills[0], id: 'second', name: 'Second skill', filePath: 'skills/second.md' }
  data.catalog.skills.push(second)
  await writeSkillFile(root, second.filePath, '# Second skill\n')
  const agents = ['GitHub Copilot', 'Antigravity'] as const
  data.catalog.collections = [
    { id: 'first-card', name: 'First card', skillIds: [skillId], agents: [...agents] },
    { id: 'second-card', name: 'Second card', skillIds: [second.id], agents: [...agents] }
  ]
  await saveVaultData(root, data)
  const toggle = async (id: string, enabled: boolean) =>
    mock.testing.dispatch({ type: 'toggleCollection', id, enabled, agents: [...agents] })
  await toggle('second-card', true)
  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle('first-card', true)
    await toggle('first-card', false)
    const saved = await readVault(root)
    const project = saved.projects.projects[0]
    for (const agent of agents) {
      expect(isAgentLinked(project, skillId, agent)).toBe(false)
      expect(isAgentLinked(project, second.id, agent)).toBe(true)
    }
    for (const folder of ['.github', '.agents']) {
      await expect(fs.stat(join(projectPath, folder, 'skills/testes-unitarios-com-vitest'))).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await fs.readFile(join(projectPath, folder, 'skills/second-skill/SKILL.md'), 'utf8')).toContain('# Second skill')
    }
    expect(saved.catalog.skills).toHaveLength(2)
    expect(mock.testing.errors).not.toHaveBeenCalled()
  }
  await toggle('second-card', false)
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('activating a second agent reuses the active publication content without modifying it', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['GitHub Copilot'] })
  const copilot = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const antigravity = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.appendFile(copilot, '\nLocal procedure clarification.')
  const content = await fs.readFile(copilot)
  const before = await fs.stat(copilot)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['Antigravity'] })
  expect(await fs.readFile(antigravity)).toEqual(content)
  expect((await fs.stat(copilot)).mtimeMs).toBe(before.mtimeMs)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('agent controls reject destinations not declared on the card', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['Antigravity']
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agents: ['GitHub Copilot'] })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('agentes exibidos'))
  expect((await readVault(root)).projects.projects).toEqual([])
  await expect(fs.stat(join(projectPath, '.github'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test.each([
  ['GitHub Copilot', '.github', '.agents'],
  ['Antigravity', '.agents', '.github']
])('saving with only %s selected publishes only its destination', async (agent, selected, excluded) => {
  const data = await readVault(root)
  data.projects.projects.push({ id: 'target', name: 'Target', sourcePath: projectPath, skillIds: [] })
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'saveSkill', ...data.catalog.skills[0], agents: [agent],
    content: '# One library source', cardColor: null, projectIds: ['target'] })
  const saved = await readVault(root)
  expect(saved.projects.projects[0].agentBindings).toEqual([{ skillId, agent }])
  expect(await fs.readFile(join(projectPath, selected, 'skills/testes-unitarios-com-vitest/SKILL.md'), 'utf8'))
    .toContain('# One library source')
  await expect(fs.stat(join(projectPath, excluded))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('deleting an empty category persists the removal without changing skills', async () => {
  await mock.testing.dispatch({ type: 'createCategory', name: 'Remover' })
  const before = await readVault(root)
  const content = await fs.readFile(join(root, before.catalog.skills[0].filePath))
  await mock.testing.dispatch({ type: 'deleteCategory', name: 'Remover' })
  const saved = await readVault(root)
  expect(saved.catalog.categories).toEqual(['Geral'])
  expect(saved.catalog.skills).toEqual(before.catalog.skills)
  expect(saved.projects).toEqual(before.projects)
  expect(await fs.readFile(join(root, before.catalog.skills[0].filePath))).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('a skill without agent labels can be saved and published through the shared standard', async () => {
  const skill = (await readVault(root)).catalog.skills[0]
  await mock.testing.dispatch({ type: 'saveSkill', ...skill, agents: [],
    content: '# Independent rule', projectIds: [], cardColor: null })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const saved = await readVault(root)
  expect(saved.catalog.skills[0].agents).toEqual([])
  expect(saved.projects.projects[0].deployedSkills).toHaveLength(2)
  const file = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  expect(skillMarkdownMetadata(await fs.readFile(file, 'utf8')).name).toBe('testes-unitarios-com-vitest')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('legacy publications consolidate on reactivation without losing project edits', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  for (const agent of ['GitHub Copilot', 'Antigravity']) {
    await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent })
  }
  const github = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const shared = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.appendFile(github, '\nShared local edit')
  await fs.appendFile(shared, '\nShared local edit')
  const content = await fs.readFile(shared)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  await expect(fs.stat(github)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(shared)).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  expect(await fs.readFile(shared)).toEqual(content)
  expect((await readVault(root)).projects.projects[0].deployedSkills).toHaveLength(2)
  expect(await fs.readFile(github)).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('divergent legacy archives block consolidation and remain preserved', async () => {
  const data = await readVault(root)
  data.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, data)
  for (const agent of ['GitHub Copilot', 'Antigravity']) {
    await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId, agent })
  }
  await fs.appendFile(join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md'), '\nDifferent edit')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const disabled = await readVault(root)
  const archiveRoot = join(root, '.skillvortex/disabled-skills')
  const projectArchive = join(archiveRoot, (await fs.readdir(archiveRoot))[0])
  const before = await Promise.all((await fs.readdir(projectArchive)).map(async path =>
    [path, await fs.readFile(join(projectArchive, path))] as const))
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('copias desativadas diferentes'))
  expect(await readVault(root)).toEqual(disabled)
  for (const entry of before) {
    const [path, content] = entry
    expect(await fs.readFile(join(projectArchive, path))).toEqual(content)
  }
})

test('imports loose Markdown and publishes a standard folder without touching neighboring originals', async () => {
  const data = await readVault(root)
  data.projects.projects.push({ id: 'project', name: 'Project', sourcePath: projectPath, skillIds: [] })
  data.projects.activeProject = 'project'
  await saveVaultData(root, data)
  const source = join(projectPath, '.agents/skills/loose.md')
  const neighbor = join(projectPath, '.agents/skills/other.md')
  await fs.mkdir(join(source, '..'), { recursive: true })
  await fs.writeFile(source, '# Loose rule\n\nUse this procedure.')
  await fs.writeFile(neighbor, '# Another rule')
  await mock.testing.dispatch({ type: 'scanProject' })
  const imported = (await readVault(root)).catalog.skills.find(item => item.name === 'Loose rule')!
  expect(imported).toBeDefined()
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: imported.id })
  const published = join(projectPath, '.agents/skills/loose-rule/SKILL.md')
  expect(skillMarkdownMetadata(await fs.readFile(published, 'utf8'))).toEqual({
    name: 'loose-rule', description: 'Use this procedure.'
  })
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: imported.id })
  await mock.testing.dispatch({ type: 'deleteSkill', id: imported.id })
  expect(await fs.readFile(source, 'utf8')).toBe('# Loose rule\n\nUse this procedure.')
  expect(await fs.readFile(neighbor, 'utf8')).toBe('# Another rule')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('collections toggle atomically and delete exclusive skills without creating extra cards', async () => {
  const data = await readVault(root)
  const second = { ...data.catalog.skills[0], id: 'second', name: 'Second rule', filePath: 'skills/second.md' }
  data.catalog.skills.push(second)
  await writeSkillFile(root, second.filePath, '# Second rule')
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'saveCollection', name: 'Quality', skillIds: [skillId, second.id, skillId] })
  const collection = (await readVault(root)).catalog.collections![0]
  expect(collection.skillIds).toEqual([skillId, second.id])
  await mock.testing.dispatch({ type: 'toggleCollection', id: collection.id, enabled: true })
  expect((await readVault(root)).projects.projects[0].deployedSkills).toHaveLength(4)
  await mock.testing.dispatch({ type: 'toggleCollection', id: collection.id, enabled: true })
  expect((await readVault(root)).projects.projects[0].skillIds).toHaveLength(2)
  await mock.testing.dispatch({ type: 'toggleCollection', id: collection.id, enabled: false })
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  await mock.testing.dispatch({ type: 'deleteCollection', id: collection.id })
  expect((await readVault(root)).catalog.collections).toEqual([])
  expect((await readVault(root)).catalog.skills).toHaveLength(0)
  await expect(fs.stat(join(root, second.filePath))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('cancelling card deletion leaves its skills and files unchanged', async () => {
  const data = await readVault(root)
  data.catalog.collections = [{ id: 'keep', name: 'Keep', skillIds: [skillId] }]
  await saveVaultData(root, data)
  const content = await fs.readFile(join(root, data.catalog.skills[0].filePath))
  mock.testing.warning.mockResolvedValueOnce(undefined)
  await mock.testing.dispatch({ type: 'deleteCollection', id: 'keep' })
  expect(await readVault(root)).toEqual(data)
  expect(await fs.readFile(join(root, data.catalog.skills[0].filePath))).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('an externally modified Markdown is reported and cannot be overwritten by a stale editor draft', async () => {
  await mock.testing.dispatch({ type: 'openSkill', id: skillId })
  const data = await readVault(root)
  const skill = data.catalog.skills[0]
  const file = join(root, skill.filePath)
  await fs.appendFile(file, '\nExternal change after opening the editor')
  await mock.testing.dispatch({ type: 'saveSkill', ...skill, content: '# Stale draft', projectIds: [], cardColor: null })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('alterado fora do gerenciador'))
  expect(await fs.readFile(file, 'utf8')).toContain('External change')
  expect(await readVault(root)).toEqual(data)
  await mock.testing.dispatch({ type: 'refresh' })
  const messages = mock.testing.postMessage.mock.calls.map(call => call[0])
  expect(messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'state', externalChanges: [
      expect.objectContaining({ skillId, libraryChanged: true })
    ] })
  ]))
})

test('a file watcher reports external edits without sending state that would replace the open draft', async () => {
  await mock.testing.dispatch({ type: 'openSkill', id: skillId })
  const data = await readVault(root)
  await fs.appendFile(join(root, data.catalog.skills[0].filePath), '\nChanged externally')
  mock.testing.postMessage.mockClear()
  mock.testing.fireFileChange()
  const started = Date.now()
  while (!mock.testing.postMessage.mock.calls.some(call => call[0].type === 'externalChanges') &&
      Date.now() - started < 3000) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const messages = mock.testing.postMessage.mock.calls.map(call => call[0])
  expect(messages).toEqual([expect.objectContaining({ type: 'externalChanges',
    externalChanges: [expect.objectContaining({ skillId, libraryChanged: true })] })])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('external review compares snapshots without modifying project files', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.appendFile(file, '\nExternal comparison')
  const content = await fs.readFile(file)
  mock.testing.quickPick
    .mockImplementationOnce(async (items: unknown[]) => items[0])
    .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.startsWith('GitHub Copilot')))
    .mockImplementationOnce(async (items: Array<{ action: string }>) => items.find(item => item.action === 'compare'))
  await mock.testing.dispatch({ type: 'reviewExternalChanges' })
  expect(mock.testing.executeCommand).toHaveBeenCalledWith('vscode.diff', expect.anything(), expect.anything(), expect.stringContaining('selecionada'))
  expect(await fs.readFile(file)).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('external review imports a chosen project version only after confirmation', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.appendFile(file, '\nAdopted through review')
  mock.testing.quickPick
    .mockImplementationOnce(async (items: unknown[]) => items[0])
    .mockImplementationOnce(async (items: Array<{ label: string }>) => items.find(item => item.label.startsWith('GitHub Copilot')))
    .mockImplementationOnce(async (items: Array<{ action: string }>) => items.find(item => item.action === 'resolve'))
  await mock.testing.dispatch({ type: 'reviewExternalChanges' })
  const saved = await readVault(root)
  expect(await fs.readFile(join(root, saved.catalog.skills[0].filePath), 'utf8')).toContain('Adopted through review')
  expect(mock.testing.warning).toHaveBeenCalledWith(expect.stringContaining('Adotar esta versao'),
    expect.objectContaining({ modal: true }), 'Criar backup e sincronizar')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test.each(['unchanged', 'merge', 'resolve'])(
  'an open synchronization notification does not block card switches: %s', async action => {
    const data = await readVault(root)
    const agents = ['GitHub Copilot', 'Antigravity']
    data.catalog.collections = [{ id: 'card', name: 'Card', skillIds: [skillId], agents }]
    await saveVaultData(root, data)
    await mock.testing.dispatch({ type: 'toggleCollection', id: 'card', enabled: true, agents })
    if (action !== 'unchanged') {
      await fs.appendFile(join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md'), '\nExternal edit')
      mock.testing.quickPick
        .mockImplementationOnce(async (items: unknown[]) => items[0])
        .mockImplementationOnce(async (items: Array<{ label: string }>) =>
          items.find(item => item.label.startsWith('GitHub Copilot')))
        .mockImplementationOnce(async (items: Array<{ action: string }>) => items.find(item => item.action === action))
    }
    let dismiss!: () => void
    const notification = new Promise<void>(resolve => { dismiss = resolve })
    mock.testing.information.mockImplementationOnce(() => notification)
    const review = mock.testing.dispatch({ type: 'reviewExternalChanges' })
    const disable = mock.testing.dispatch({ type: 'toggleCollection', id: 'card', enabled: false, agents })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        disable,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('The notification blocked the card switch')), 1000)
        })
      ])
      expect(mock.testing.information).toHaveBeenCalled()
      expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
      for (const folder of ['.github', '.agents']) {
        await expect(fs.stat(join(projectPath, folder, 'skills/testes-unitarios-com-vitest')))
          .rejects.toMatchObject({ code: 'ENOENT' })
      }
      expect(mock.testing.errors).not.toHaveBeenCalled()
    } finally {
      clearTimeout(timeout)
      dismiss()
      await review
      await disable
    }
  }
)

test('deleting an empty card preserves every other card and skill', async () => {
  const data = await readVault(root)
  data.catalog.collections = [
    { id: 'keep', name: 'Keep', skillIds: [skillId] },
    { id: 'empty', name: 'Empty', skillIds: [] }
  ]
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'deleteCollection', id: 'empty' })
  const saved = await readVault(root)
  expect(saved.catalog.collections).toEqual([data.catalog.collections[0]])
  expect(saved.catalog.skills).toEqual(data.catalog.skills)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('a collection conflict rolls back every publication and metadata change', async () => {
  const data = await readVault(root)
  const second = { ...data.catalog.skills[0], id: 'second', name: 'Second rule', filePath: 'skills/second.md' }
  data.catalog.skills.push(second)
  data.catalog.collections = [{ id: 'quality', name: 'Quality', skillIds: [skillId, second.id] }]
  await writeSkillFile(root, second.filePath, '# Second')
  await saveVaultData(root, data)
  const conflicting = join(projectPath, '.agents/skills/second-rule/SKILL.md')
  await fs.mkdir(join(conflicting, '..'), { recursive: true })
  await fs.writeFile(conflicting, 'Do not overwrite')
  await mock.testing.dispatch({ type: 'toggleCollection', id: 'quality', enabled: true })
  expect(mock.testing.errors).toHaveBeenCalled()
  expect(await readVault(root)).toEqual(data)
  expect(await fs.readFile(conflicting, 'utf8')).toBe('Do not overwrite')
  await expect(fs.stat(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')))
    .rejects.toMatchObject({ code: 'ENOENT' })
})

test('collection validation reports missing skills, duplicate names and blocked activation', async () => {
  await mock.testing.dispatch({ type: 'saveCollection', name: 'Quality', skillIds: ['missing'] })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('nao encontrada'))
  await mock.testing.dispatch({ type: 'saveCollection', name: 'Quality', skillIds: [skillId] })
  const saved = await readVault(root)
  await mock.testing.dispatch({ type: 'saveCollection', name: 'quality', skillIds: [skillId] })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('ja existe'))
  saved.catalog.skills[0].status = 'blocked'
  await saveVaultData(root, saved)
  await mock.testing.dispatch({ type: 'toggleCollection', id: saved.catalog.collections![0].id, enabled: true })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('bloqueadas'))
  expect(await readVault(root)).toEqual(saved)
})

test('unlinking and deleting skills remove only their collection membership', async () => {
  const data = await readVault(root)
  data.catalog.collections = [{ id: 'quality', name: 'Quality', skillIds: [skillId] }]
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'unlinkSkill', id: skillId })
  expect((await readVault(root)).catalog.collections![0].skillIds).toEqual([])
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'deleteSkill', id: skillId })
  expect((await readVault(root)).catalog.collections![0].skillIds).toEqual([])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('deleting an occupied category is blocked even when its skills are inactive', async () => {
  const before = await readVault(root)
  await mock.testing.dispatch({ type: 'deleteCategory', name: 'Geral' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('Mova todas'))
  expect(await readVault(root)).toEqual(before)
})

test('deleting an unknown category reports an error without changing the vault', async () => {
  const before = await readVault(root)
  await mock.testing.dispatch({ type: 'deleteCategory', name: 'Ausente' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('Categoria nao encontrada'))
  expect(await readVault(root)).toEqual(before)
})

test('the last empty category can be deleted and new skills still receive a valid category', async () => {
  const data = await readVault(root)
  data.catalog.skills = []
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'deleteCategory', name: 'Geral' })
  expect((await readVault(root)).catalog.categories).toEqual([])
  await mock.testing.dispatch({ type: 'createSkill', cardColor: null })
  const draft = pendingDraft()
  expect(draft.skill.category).toBe('Geral')
  expect((await readVault(root)).catalog.skills).toEqual([])
  await mock.testing.dispatch({ type: 'saveSkill', ...draft.skill,
    tags: ['test'], cardColor: null, content: draft.content, projectIds: [] })
  const saved = await readVault(root)
  expect(saved.catalog.categories).toEqual(['Geral'])
  expect(saved.catalog.skills[0].category).toBe('Geral')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('loading examples rejects an existing card without changing the vault', async () => {
  const before = await readVault(root)
  const files = await fs.readdir(join(root, 'skills'))
  await mock.testing.dispatch({ type: 'createDocumentedExamples' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('nenhum card'))
  expect(await readVault(root)).toEqual(before)
  expect(await fs.readdir(join(root, 'skills'))).toEqual(files)
})

test('loading examples is allowed only once in an empty library', async () => {
  const data = await readVault(root)
  data.catalog.skills = []
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'createDocumentedExamples' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
  const saved = await readVault(root)
  expect(saved.catalog.skills).toHaveLength(7)
  expect(skillCards(saved.catalog)).toHaveLength(4)
  expect(skillCards(saved.catalog).map(card => card.skillIds.length)).toEqual([1, 4, 2, 0])
  await mock.testing.dispatch({ type: 'createDocumentedExamples' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('nenhum card'))
  expect(await readVault(root)).toEqual(saved)
})

test('deleting the last card leaves examples and first-card creation available', async () => {
  const data = await readVault(root)
  data.catalog.skills = []
  data.catalog.collections = [{ id: 'last', name: 'Last card', skillIds: [] }]
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'deleteCollection', id: 'last' })
  expect(skillCards((await readVault(root)).catalog)).toHaveLength(0)
  await mock.testing.dispatch({ type: 'createDocumentedExamples' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
  expect(skillCards((await readVault(root)).catalog)).toHaveLength(4)
})

test('a card without a real agent destination cannot be saved as activatable', async () => {
  await mock.testing.dispatch({ type: 'saveCollection', name: 'No destination', skillIds: [],
    category: 'Geral', description: 'Card without supported destinations', tags: ['test'],
    agents: ['Team custom label'], status: 'pending', cardColor: null })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('GitHub Copilot ou Antigravity'))
  expect((await readVault(root)).catalog.collections ?? []).toHaveLength(0)
})

test('an empty card prevents loading examples and its category cannot be removed', async () => {
  const data = await readVault(root)
  data.catalog.skills = []
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'saveCollection', name: 'Empty', skillIds: [],
    category: 'Geral', description: 'Ready for rules', tags: ['empty'], agents: ['GitHub Copilot'],
    status: 'pending', cardColor: '#1677ff' })
  const saved = await readVault(root)
  expect(skillCards(saved.catalog)).toHaveLength(1)
  expect(skillCards(saved.catalog)[0]).toMatchObject({
    name: 'Empty', category: 'Geral', description: 'Ready for rules', tags: ['empty'], skillIds: [],
    agents: ['GitHub Copilot'], status: 'pending', cardColor: '#1677ff'
  })
  await mock.testing.dispatch({ type: 'createDocumentedExamples' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('nenhum card'))
  await mock.testing.dispatch({ type: 'deleteCategory', name: 'Geral' })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('Mova todas'))
  expect(await readVault(root)).toEqual(saved)
  await mock.testing.dispatch({ type: 'toggleCollection', id: saved.catalog.collections![0].id, enabled: true })
  expect(mock.testing.errors).toHaveBeenCalledWith(expect.stringContaining('Adicione skills'))
})

test('adding a new skill to an empty card keeps one card and persists membership', async () => {
  const data = await readVault(root)
  data.catalog.skills = []
  data.catalog.categories.push('Git')
  data.catalog.collections = [{ id: 'empty', name: 'Empty', category: 'Git', skillIds: [] }]
  await saveVaultData(root, data)
  await mock.testing.dispatch({ type: 'createSkill', collectionId: 'empty', cardColor: null })
  const draft = pendingDraft()
  expect((await readVault(root)).catalog.collections![0].skillIds).toEqual([])
  await mock.testing.dispatch({ type: 'saveSkill', ...draft.skill,
    tags: ['test'], cardColor: null, content: draft.content, projectIds: [] })
  const saved = await readVault(root)
  expect(skillCards(saved.catalog)).toHaveLength(1)
  expect(saved.catalog.skills).toHaveLength(1)
  expect(saved.catalog.skills[0].category).toBe('Git')
  expect(saved.catalog.collections![0].skillIds).toEqual([saved.catalog.skills[0].id])
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('example visibility follows project skill Markdown, not root documentation', async () => {
  await fs.writeFile(join(projectPath, 'README.md'), '# Project')
  await mock.testing.dispatch({ type: 'refresh' })
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    hasProjectMarkdown: false
  }))
  const markdown = join(projectPath, '.agents/skills/custom/SKILL.md')
  await fs.mkdir(join(markdown, '..'), { recursive: true })
  await fs.writeFile(markdown, '# Custom skill')
  await mock.testing.dispatch({ type: 'refresh' })
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    hasProjectMarkdown: true
  }))
  await fs.unlink(markdown)
  await mock.testing.dispatch({ type: 'refresh' })
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    hasProjectMarkdown: false
  }))
})

test('project search offers custom skill files and excludes documentation without duplicating imports', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const project = (await readVault(root)).projects.projects[0]
  const sourceRoot = await fs.realpath(projectPath)
  const published = join(sourceRoot, '.agents', 'skills', project.deployedSkills![0].directory, 'SKILL.md')
  const candidates = [
    { path: '.github/skills/exemplo/1-skill-de-teste.md', content: '# Skill de teste\n\nTesta algo.' },
    { path: '.agents/skills/exemplo/ANALISE-SEO.md', content: '# Analise SEO\n\nAnalisa SEO.' },
    { path: '.agent/skills/exemplo/OUTRA.MD', content: '# Outra skill\n\nOutra descricao.' }
  ]
  const ignored = [
    '.github/skills/exemplo/README.md', '.github/skills/exemplo/CONTRIBUTING.md',
    '.github/skills/exemplo/docs/nao-importar.md', '.agents/skills/exemplo/CONFIGURACAO.md',
    '.github/copilot-instructions.md', '.agent/workflows/deploy.md'
  ]
  for (const item of [...candidates, ...ignored.map(path => ({ path, content: '# Documento' }))]) {
    const file = join(sourceRoot, item.path)
    await fs.mkdir(join(file, '..'), { recursive: true })
    await fs.writeFile(file, item.content)
  }

  await mock.testing.dispatch({ type: 'scanProject' })

  expect(mock.testing.quickPick).toHaveBeenCalledTimes(1)
  const firstSelection = mock.testing.quickPick.mock.calls[0][0]
  expect(firstSelection).toHaveLength(5)
  expect(firstSelection).toEqual(expect.arrayContaining([
    expect.objectContaining({
      file: join(sourceRoot, candidates[0].path), label: '1-skill-de-teste.md',
      description: expect.stringContaining('Copilot'), picked: true
    }),
    expect.objectContaining({
      file: join(sourceRoot, candidates[1].path), label: 'ANALISE-SEO.md',
      description: expect.stringContaining('Antigravity'), picked: true
    }),
    expect.objectContaining({
      file: join(sourceRoot, candidates[2].path), label: 'OUTRA.MD', picked: true
    }),
    expect.objectContaining({ file: published, detail: 'Publicada pelo SkillVortex', picked: false })
  ]))
  const imported = await readVault(root)
  expect(imported.catalog.skills).toHaveLength(4)
  for (const item of candidates) {
    const skill = imported.catalog.skills.find(candidate => candidate.originPath === join(sourceRoot, item.path))
    expect(skill).toBeDefined()
    expect(await fs.readFile(join(root, skill!.filePath), 'utf8')).toBe(item.content)
  }

  await mock.testing.dispatch({ type: 'backToDashboard' })
  await mock.testing.dispatch({ type: 'scanProject' })
  expect(mock.testing.quickPick).toHaveBeenCalledTimes(2)
  const secondSelection = mock.testing.quickPick.mock.calls[1][0]
  expect(secondSelection).toHaveLength(5)
  for (const item of candidates) {
    expect(secondSelection).toEqual(expect.arrayContaining([
      expect.objectContaining({
        file: join(sourceRoot, item.path), detail: 'Ja importado na biblioteca', picked: false
      })
    ]))
  }
  expect((await readVault(root)).catalog.skills).toHaveLength(4)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('a card can be unlinked, imported again and activated while its project file already exists', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const active = await readVault(root)
  const directory = active.projects.projects[0].deployedSkills![0].directory
  const markdown = join(projectPath, '.agents/skills', directory, 'SKILL.md')
  await fs.appendFile(markdown, '\nLocal edits after publication.\r\n')
  const content = await fs.readFile(markdown)
  await fs.writeFile(join(projectPath, '.github/skills', directory, 'SKILL.md'), content)
  await mock.testing.dispatch({ type: 'unlinkSkill', id: skillId })
  const canonicalMarkdown = await fs.realpath(markdown)
  mock.testing.quickPick.mockImplementationOnce(async (items: Array<{ file: string }>) =>
    items.filter(item => item.file === canonicalMarkdown))
  await mock.testing.dispatch({ type: 'scanProject' })
  const imported = (await readVault(root)).catalog.skills.find(skill => skill.id !== skillId)!
  expect(imported.originPath).toBe(await fs.realpath(markdown))

  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: imported.id })

  const enabled = await readVault(root)
  expect(enabled.projects.projects[0].skillIds).toEqual([imported.id])
  expect(enabled.projects.projects[0].deployedSkills![0].directory).toBe(directory)
  expect(await fs.readFile(markdown)).toEqual(content)
  await mock.testing.dispatch({ type: 'backToDashboard' })
  await mock.testing.dispatch({ type: 'createCategory', name: 'Other' })
  expect(await fs.readFile(markdown)).toEqual(content)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('project search also discovers skills in other open workspace roots', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const project = (await readVault(root)).projects.projects[0]
  const linkedRoot = await fs.realpath(project.sourcePath!)
  const workspacePath = join(temporary, 'workspace on another path')
  await fs.mkdir(join(workspacePath, '.github', 'skills', 'html'), { recursive: true })
  const openWorkspaceRoot = await fs.realpath(workspacePath)
  const workspaceSkill = join(openWorkspaceRoot, '.github', 'skills', 'html', '1-skill-de-teste.md')
  await fs.writeFile(workspaceSkill, '# Skill no workspace\n\nEncontrada fora da pasta associada.')
  mock.workspace.workspaceFolders = [
    { uri: { fsPath: projectPath, scheme: 'file' } },
    { uri: { fsPath: openWorkspaceRoot, scheme: 'file' } }
  ]

  await mock.testing.dispatch({ type: 'scanProject' })

  expect(mock.testing.quickPick).toHaveBeenCalledTimes(1)
  const selection = mock.testing.quickPick.mock.calls[0][0]
  expect(selection).toEqual(expect.arrayContaining([
    expect.objectContaining({
      file: workspaceSkill,
      label: '1-skill-de-teste.md',
      description: expect.stringContaining('Copilot'),
      detail: workspaceSkill,
      picked: true
    })
  ]))
  const imported = (await readVault(root)).catalog.skills.find(item => item.originPath === workspaceSkill)
  expect(imported).toBeDefined()
  expect(await fs.readFile(join(root, imported!.filePath), 'utf8'))
    .toBe('# Skill no workspace\n\nEncontrada fora da pasta associada.')
  expect(linkedRoot).not.toBe(await fs.realpath(openWorkspaceRoot))
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('saving a skill uses a readable file path derived from its title', async () => {
  const data = await readVault(root)
  const skill = data.catalog.skills[0]
  const previousFilePath = skill.filePath

  await mock.testing.dispatch({
    type: 'saveSkill',
    ...skill,
    name: 'Verifica consistência do HTML',
    description: 'Verifica consistencia, estrutura e acessibilidade de arquivos HTML.',
    content: '# Verifica consistência do HTML\n',
    projectIds: []
  })

  const saved = await readVault(root)
  expect(saved.catalog.skills[0].filePath).toBe('skills/verifica-consistencia-do-html.md')
  expect(await fs.readFile(join(root, saved.catalog.skills[0].filePath), 'utf8'))
    .toContain('# Verifica consistência do HTML')
  await expect(fs.stat(join(root, previousFilePath))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('saving a skill requires a non-empty description', async () => {
  const skill = (await readVault(root)).catalog.skills[0]

  await mock.testing.dispatch({
    type: 'saveSkill',
    ...skill,
    description: '   ',
    projectIds: []
  })

  expect(mock.testing.errors).toHaveBeenCalled()
  expect(await readVault(root)).toMatchObject({ catalog: { skills: [{ description: skill.description }] } })
})

test.each([
  ['name', '   '],
  ['category', ''],
  ['description', '   '],
  ['tags', []],
  ['tags', ['   ']],
  ['agents', ['   ']],
  ['status', ''],
  ['content', ' \n\t ']
])('rejects an empty required registration field: %s (%j)', async (field, value) => {
  const before = await readVault(root)
  const skill = before.catalog.skills[0]
  const content = await fs.readFile(join(root, skill.filePath), 'utf8')

  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, cardColor: null, content, projectIds: [],
    [field as string]: value
  })

  expect(mock.testing.errors).toHaveBeenCalledTimes(1)
  expect(await readVault(root)).toEqual(before)
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toBe(content)
})

test('legacy creation messages carrying a color remain compatible', async () => {
  await mock.testing.dispatch({ type: 'createSkill', cardColor: SKILL_CARD_COLORS[8] })
  const created = pendingDraft().skill
  expect(created.cardColor).toBe(SKILL_CARD_COLORS[8])
  await mock.testing.dispatch({ type: 'createSkill', cardColor: '#abcdef' })
  expect(mock.testing.errors).toHaveBeenCalled()
  expect((await readVault(root)).catalog.skills).toHaveLength(1)
})

test('a new skill keeps its chosen card color until it is reset to automatic', async () => {
  await mock.testing.dispatch({ type: 'createSkill' })
  const { skill: created, content } = pendingDraft()
  expect(created.cardColor).toBeUndefined()
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    editingSkillId: created.id
  }))

  await mock.testing.dispatch({
    type: 'saveSkill', ...created, tags: ['teste'], agents: ['GitHub Copilot'],
    cardColor: SKILL_CARD_COLORS[6], content, projectIds: []
  })

  const saved = (await readVault(root)).catalog.skills.find(skill => skill.id === created.id)!
  expect(saved.cardColor).toBe(SKILL_CARD_COLORS[6])
  const persisted = JSON.parse(await fs.readFile(join(root, '.skillvortex/catalogo.json'), 'utf8'))
  expect(persisted.skills.find((skill: { id: string }) => skill.id === created.id).cardColor)
    .toBe(SKILL_CARD_COLORS[6])

  await mock.testing.dispatch({ type: 'backToDashboard' })
  await mock.testing.dispatch({ type: 'openSkill', id: created.id })
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    editingSkillId: created.id,
    catalog: expect.objectContaining({ skills: expect.arrayContaining([
      expect.objectContaining({ id: created.id, cardColor: SKILL_CARD_COLORS[6] })
    ]) })
  }))

  const { cardColor: _cardColor, ...legacyMessage } = saved
  await mock.testing.dispatch({ type: 'saveSkill', ...legacyMessage, content, projectIds: [] })
  expect((await readVault(root)).catalog.skills.find(skill => skill.id === created.id)?.cardColor)
    .toBe(SKILL_CARD_COLORS[6])

  await mock.testing.dispatch({ type: 'saveSkill', ...saved, cardColor: null, content, projectIds: [] })
  const automatic = (await readVault(root)).catalog.skills.find(skill => skill.id === created.id)!
  expect(automatic.cardColor).toBeUndefined()
  const cleared = JSON.parse(await fs.readFile(join(root, '.skillvortex/catalogo.json'), 'utf8'))
  expect(cleared.skills.find((skill: { id: string }) => skill.id === created.id))
    .not.toHaveProperty('cardColor')
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('saving from the editor preserves each of the ten card colors', async () => {
  await mock.testing.dispatch({ type: 'createSkill' })
  const { skill: created, content } = pendingDraft()

  for (const cardColor of SKILL_CARD_COLORS) {
    await mock.testing.dispatch({
      type: 'saveSkill', ...created, tags: ['teste'], agents: ['GitHub Copilot'],
      cardColor, content, projectIds: []
    })
    expect((await readVault(root)).catalog.skills.find(skill => skill.id === created.id)?.cardColor)
      .toBe(cardColor)
  }
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('rejects a card color outside the fixed palette without changing the vault', async () => {
  const before = await readVault(root)
  const skill = before.catalog.skills[0]
  const content = await fs.readFile(join(root, skill.filePath), 'utf8')

  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, cardColor: '#abcdef', content: '# Changed', projectIds: []
  })

  expect(mock.testing.errors).toHaveBeenCalled()
  expect(await readVault(root)).toEqual(before)
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toBe(content)
})

test('saving an active skill is rejected and preserves local edits', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const before = await readVault(root)
  const project = before.projects.projects[0]
  const skill = before.catalog.skills[0]
  const file = join(projectPath, '.agents/skills', project.deployedSkills![0].directory, 'SKILL.md')
  await fs.appendFile(file, '\nLocal edit')
  const projectContent = await fs.readFile(file, 'utf8')
  const content = await fs.readFile(join(root, skill.filePath), 'utf8')

  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, cardColor: SKILL_CARD_COLORS[7], content, projectIds: [project.id]
  })

  expect(await readVault(root)).toEqual(before)
  expect(await fs.readFile(file, 'utf8')).toBe(projectContent)
  expect(mock.testing.errors).toHaveBeenCalledWith(
    'SkillVortex: Desative a skill em todos os projetos antes de editar, desvincular ou excluir.'
  )
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

test('active skills cannot be edited or deleted even when another project is selected', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const data = await readVault(root)
  data.projects.projects.push({ id: 'other', name: 'Other', skillIds: [] })
  data.projects.activeProject = 'other'
  await saveVaultData(root, data)
  const before = await readVault(root)

  for (const type of ['openSkill', 'deleteSkill']) {
    await mock.testing.dispatch({ type, id: skillId })
  }
  await mock.testing.dispatch({ type: 'runSkill', id: skillId })

  expect(mock.testing.warning).not.toHaveBeenCalled()
  expect(mock.testing.executeCommand).not.toHaveBeenCalled()
  expect(mock.testing.errors).toHaveBeenCalledTimes(3)
  expect(mock.testing.errors).toHaveBeenLastCalledWith(
    'SkillVortex: Ative a skill no projeto antes de executa-la.'
  )
  expect(await readVault(root)).toEqual(before)
})

test('unlinking an active card preserves the published project Markdown', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const active = await readVault(root)
  const project = active.projects.projects[0]
  const deployed = project.deployedSkills![0]
  const markdown = join(projectPath, '.agents/skills', deployed.directory, 'SKILL.md')
  const originalMarkdown = await fs.readFile(markdown)
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    publishedMarkdown: expect.arrayContaining([skillId, `Antigravity:${skillId}`])
  }))

  await mock.testing.dispatch({ type: 'unlinkSkill', id: skillId })

  const unlinked = await readVault(root)
  expect(unlinked.catalog.skills).toHaveLength(0)
  expect(unlinked.projects.projects[0].skillIds).toEqual([])
  expect(unlinked.projects.projects[0].deployedSkills).toEqual([])
  expect(await fs.readFile(markdown)).toEqual(originalMarkdown)
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('saving an inactive skill with a project selected returns to the dashboard', async () => {
  const data = await readVault(root)
  data.projects.projects.push({ id: 'project', name: 'Project', sourcePath: projectPath, skillIds: [] })
  data.projects.activeProject = 'project'
  await saveVaultData(root, data)
  const skill = data.catalog.skills[0]
  const content = await fs.readFile(join(root, skill.filePath), 'utf8')
  await mock.testing.dispatch({ type: 'openSkill', id: skillId })
  await mock.testing.dispatch({
    type: 'saveSkill', ...skill, cardColor: null, content, projectIds: ['project']
  })

  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([skillId])
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    editingSkillId: null, saved: true
  }))
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('confirmed deletion removes the card, archived Markdown and whole published folder', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const active = await readVault(root)
  const folder = join(projectPath, '.agents/skills', active.projects.projects[0].deployedSkills![0].directory)
  await fs.writeFile(join(folder, 'extra.txt'), 'Delete with generated folder')
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const disabled = await readVault(root)
  const vaultFile = join(root, disabled.catalog.skills[0].filePath)

  await mock.testing.dispatch({ type: 'deleteSkill', id: skillId })

  expect(mock.testing.warning).toHaveBeenCalledWith(
    expect.stringContaining('Excluir permanentemente'),
    expect.objectContaining({ modal: true, detail: expect.stringContaining(folder) }),
    'Excluir permanentemente'
  )
  expect((await readVault(root)).catalog.skills).toHaveLength(0)
  await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(vaultFile)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('deleting after deactivation leaves neither the Markdown nor its published directory', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const active = await readVault(root)
  const folder = join(projectPath, '.agents/skills', active.projects.projects[0].deployedSkills![0].directory)
  const vaultFile = join(root, active.catalog.skills[0].filePath)
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })
  await mock.testing.dispatch({ type: 'deleteSkill', id: skillId })
  expect((await readVault(root)).catalog.skills).toHaveLength(0)
  await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(vaultFile)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('manual project creation is no longer accepted', async () => {
  const before = await readVault(root)
  await mock.testing.dispatch({ type: 'createProject', name: 'Manual project' })
  expect(await readVault(root)).toEqual(before)
  expect(mock.testing.errors).toHaveBeenCalled()
})

test('cancelling deletion preserves the skill and all files', async () => {
  const data = await readVault(root)
  const file = join(root, data.catalog.skills[0].filePath)
  mock.testing.warning.mockReturnValueOnce(Promise.resolve(undefined))
  await mock.testing.dispatch({ type: 'deleteSkill', id: skillId })
  expect(await readVault(root)).toEqual(data)
  expect(await fs.readFile(file, 'utf8')).toContain('Testes Unitários com Vitest')
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

test('a legacy link without a project folder can be disabled without selecting a folder', async () => {
  const data = await readVault(root)
  data.projects.projects.push({ id: 'legacy', name: 'Legacy', skillIds: [skillId] })
  data.projects.activeProject = 'legacy'
  await saveVaultData(root, data)
  mock.workspace.workspaceFolders = []

  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  await mock.testing.dispatch({ type: 'openSkill', id: skillId })

  expect(mock.testing.dialog).not.toHaveBeenCalled()
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  expect(mock.testing.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ editingSkillId: skillId }))
  expect(mock.testing.errors).not.toHaveBeenCalled()
})

test('the save message reports a project conflict and restores the vault Markdown', async () => {
  await mock.testing.dispatch({ type: 'toggleProjectSkill', id: skillId })
  const data = await readVault(root)
  const project = data.projects.projects[0]
  const skill = data.catalog.skills[0]
  const file = join(projectPath, '.agents/skills', project.deployedSkills![0].directory, 'SKILL.md')
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
