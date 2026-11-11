import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'
import { saveProjectSkills, skillMarkdownMetadata } from '../src/project-skills'
import { createDocumentedExamples } from '../src/documented-examples'
import { createVaultBackup, restoreVaultBackup } from '../src/backup'
import { isAgentLinked, projectBindings, setProjectBindings, setSharedSkillPublication, type VaultData } from '../src/model'

let temporary: string
let root: string
let projectPath: string
let original: VaultData

beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-project-skills-'))
  root = join(temporary, 'vault')
  projectPath = join(temporary, 'project')
  await fs.mkdir(projectPath)
  await createVault(root)
  original = await readVault(root)
  const example = createDocumentedExamples()[7]
  example.skill.category = 'Geral'
  original.catalog.skills.push(example.skill)
  original.projects.projects.push({ id: 'project', name: 'Project', sourcePath: projectPath, skillIds: [] })
  original.projects.activeProject = 'project'
  await writeSkillFile(root, example.skill.filePath, example.content)
  await saveVaultData(root, original)
})
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })

async function activateSkill(): Promise<{ data: VaultData; file: string }> {
  const data = structuredClone(original)
  data.projects.projects[0].skillIds = [data.catalog.skills[0].id]
  await saveProjectSkills(root, original, data)
  const deployed = data.projects.projects[0].deployedSkills![0]
  return { data, file: join(projectPath, '.github/skills', deployed.directory, 'SKILL.md') }
}

test('the released Vitest example is published as a discoverable Copilot skill', async () => {
  const { data, file } = await activateSkill()
  const content = await fs.readFile(file, 'utf8')
  expect(content).toMatch(/^---\nname: testes-unitarios-com-vitest\ndescription: ".+"\n---\n\n# Testes Unitários com Vitest/)
  expect(data.projects.projects[0].deployedSkills![0].directory).toBe('testes-unitarios-com-vitest')
  expect(data.catalog.skills[0].status).toBe('allowed')
  expect(data.catalog.skills[0].publishedFolders![0].marker).toBeUndefined()
  expect((await fs.readdir(join(file, '..'))).some(name => name.startsWith('.skillvortex-'))).toBe(false)
  expect(await readVault(root)).toEqual(data)
})

test('archived standalone skills and collection members cannot be published', async () => {
  const data = structuredClone(original)
  const skill = data.catalog.skills[0]
  data.projects.projects[0].skillIds = [skill.id]
  skill.archived = true
  await expect(saveProjectSkills(root, original, data)).rejects.toThrow('arquivado')
  skill.archived = false
  data.catalog.collections = [{ id: 'archived-card', name: 'Archived card', skillIds: [skill.id], archived: true }]
  await expect(saveProjectSkills(root, original, data)).rejects.toThrow('arquivado')
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
})

test('shared publication preserves optional YAML fields and avoids nested frontmatter', async () => {
  const skill = original.catalog.skills[0]
  const content = '---\nname: old-name\ndescription: |\n  Old multiline description.\nlicense: MIT\nmetadata:\n  author: example\n---\n\n# Procedure\n'
  await writeSkillFile(root, skill.filePath, content)
  const data = structuredClone(original)
  setSharedSkillPublication(data.projects.projects[0], skill.id, true)
  await saveProjectSkills(root, original, data)
  const published = await fs.readFile(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md'), 'utf8')
  expect(skillMarkdownMetadata(published)).toEqual({
    name: 'testes-unitarios-com-vitest', description: skill.description
  })
  expect(published).toContain('license: MIT')
  expect(published).toContain('author: example')
  expect(published).not.toContain('Old multiline description.')
  expect(published.match(/^---$/gm)).toHaveLength(2)
  expect(published).toContain('# Procedure')
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toBe(content)
})

test('invalid YAML reports an error and leaves shared publication inactive', async () => {
  const skill = original.catalog.skills[0]
  await writeSkillFile(root, skill.filePath, '---\nname: [invalid\n---\n# Procedure')
  const data = structuredClone(original)
  setSharedSkillPublication(data.projects.projects[0], skill.id, true)
  await expect(saveProjectSkills(root, original, data)).rejects.toThrow('YAML invalido')
  expect(await readVault(root)).toEqual(original)
  await expect(fs.stat(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')))
    .rejects.toMatchObject({ code: 'ENOENT' })
})

test('dual publication updates and disables both folders from one library skill', async () => {
  const skill = original.catalog.skills[0]
  const enabled = structuredClone(original)
  setSharedSkillPublication(enabled.projects.projects[0], skill.id, true)
  await saveProjectSkills(root, original, enabled)
  const files = ['.github', '.agents'].map(folder =>
    join(projectPath, folder, 'skills/testes-unitarios-com-vitest/SKILL.md'))
  expect(await fs.readFile(files[0])).toEqual(await fs.readFile(files[1]))
  const updated = structuredClone(enabled)
  await writeSkillFile(root, skill.filePath, '# Updated procedure')
  await saveProjectSkills(root, enabled, updated)
  for (const file of files) expect(await fs.readFile(file, 'utf8')).toContain('# Updated procedure')
  const disabled = structuredClone(updated)
  setSharedSkillPublication(disabled.projects.projects[0], skill.id, false)
  await saveProjectSkills(root, updated, disabled)
  for (const file of files) await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(disabled.projects.projects[0].skillIds).toEqual([])
})

test('a conflict in the Copilot destination rolls back the other publication', async () => {
  const skill = original.catalog.skills[0]
  const copilot = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const foreign = '---\nname: testes-unitarios-com-vitest\ndescription: Other\n---\n# Preserve this'
  await fs.mkdir(join(copilot, '..'), { recursive: true })
  await fs.writeFile(copilot, foreign)
  const enabled = structuredClone(original)
  setSharedSkillPublication(enabled.projects.projects[0], skill.id, true)
  await expect(saveProjectSkills(root, original, enabled)).rejects.toThrow('Ja existe outro SKILL.md')
  expect(await fs.readFile(copilot, 'utf8')).toBe(foreign)
  await expect(fs.stat(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')))
    .rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readVault(root)).toEqual(original)
})

test('enabling shared publication keeps unrelated legacy bindings valid', async () => {
  const first = original.catalog.skills[0]
  const second = { ...first, id: 'second', name: 'Second rule', filePath: 'skills/second.md' }
  original.catalog.skills.push(second)
  original.projects.projects[0].skillIds = [first.id]
  await writeSkillFile(root, second.filePath, '# Second')
  await saveVaultData(root, original)
  const data = structuredClone(original)
  setSharedSkillPublication(data.projects.projects[0], second.id, true)
  await saveProjectSkills(root, original, data)
  expect(await fs.readFile(join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md'), 'utf8')).toContain('Vitest')
  expect(await fs.readFile(join(projectPath, '.agents/skills/second-rule/SKILL.md'), 'utf8')).toContain('# Second')
  expect(await readVault(root)).toEqual(data)
})

test('reactivation converts a legacy plain Markdown archive while preserving its body', async () => {
  const skill = original.catalog.skills[0]
  const origin = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const body = '# Original plain skill\n\nLocal changes.\r\n'
  await fs.mkdir(join(origin, '..'), { recursive: true })
  await fs.writeFile(origin, body)
  skill.originPath = origin
  await saveVaultData(root, original)
  const enabled = structuredClone(original)
  enabled.projects.projects[0].skillIds = [skill.id]
  await saveProjectSkills(root, original, enabled)
  const disabled = structuredClone(enabled)
  setSharedSkillPublication(disabled.projects.projects[0], skill.id, false)
  await saveProjectSkills(root, enabled, disabled)
  const restored = structuredClone(disabled)
  setSharedSkillPublication(restored.projects.projects[0], skill.id, true)
  await saveProjectSkills(root, disabled, restored)
  const published = await fs.readFile(join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md'), 'utf8')
  expect(skillMarkdownMetadata(published)).toEqual({ name: 'testes-unitarios-com-vitest', description: skill.description })
  expect(published.endsWith(body)).toBe(true)
  expect(await fs.readFile(origin, 'utf8')).toBe(published)
})

test('backups retain collections and shared publication metadata', async () => {
  original.catalog.collections = [{ id: 'quality', name: 'Quality', skillIds: [original.catalog.skills[0].id] }]
  original.projects.projects[0].sharedPublication = true
  await saveVaultData(root, original)
  const backup = await createVaultBackup(root)
  const changed = structuredClone(original)
  changed.catalog.collections = []
  await saveVaultData(root, changed)
  await restoreVaultBackup(root, backup.id)
  expect(await readVault(root)).toEqual(original)
})

test('shared content has independent deployments and archives for each agent', async () => {
  const skill = original.catalog.skills[0]
  skill.agents = ['GitHub Copilot', 'Antigravity']
  await saveVaultData(root, original)
  const github = structuredClone(original)
  setProjectBindings(github.projects.projects[0], [{ skillId: skill.id, agent: 'GitHub Copilot' }])
  await saveProjectSkills(root, original, github)
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  const agentsFile = join(projectPath, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
  await expect(fs.stat(agentsFile)).rejects.toMatchObject({ code: 'ENOENT' })
  const both = structuredClone(github)
  setProjectBindings(both.projects.projects[0], [
    ...projectBindings(both.projects.projects[0]), { skillId: skill.id, agent: 'Antigravity' }
  ])
  await saveProjectSkills(root, github, both)
  expect(await fs.readFile(agentsFile)).toEqual(await fs.readFile(file))
  await fs.appendFile(file, '\nCopilot-only edit')
  await fs.appendFile(agentsFile, '\nAntigravity-only edit')
  const githubContent = await fs.readFile(file)
  const agentsContent = await fs.readFile(agentsFile)
  const onlyAgents = structuredClone(both)
  setProjectBindings(onlyAgents.projects.projects[0], [{ skillId: skill.id, agent: 'Antigravity' }])
  await saveProjectSkills(root, both, onlyAgents)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(agentsFile)).toEqual(agentsContent)
  expect(isAgentLinked(onlyAgents.projects.projects[0], skill.id, 'Antigravity')).toBe(true)
  const neither = structuredClone(onlyAgents)
  setProjectBindings(neither.projects.projects[0], [])
  await saveProjectSkills(root, onlyAgents, neither)
  await expect(fs.stat(agentsFile)).rejects.toMatchObject({ code: 'ENOENT' })
  const again = structuredClone(neither)
  setProjectBindings(again.projects.projects[0], [
    { skillId: skill.id, agent: 'GitHub Copilot' }, { skillId: skill.id, agent: 'Antigravity' }
  ])
  await saveProjectSkills(root, neither, again)
  expect(await fs.readFile(file)).toEqual(githubContent)
  expect(await fs.readFile(agentsFile)).toEqual(agentsContent)
})

test('legacy deployments stay in .github even when their shared registration has both agents', async () => {
  original.catalog.skills[0].agents = ['GitHub Copilot', 'Antigravity']
  const { data, file } = await activateSkill()
  expect(projectBindings(data.projects.projects[0])).toEqual([
    { skillId: data.catalog.skills[0].id, agent: 'GitHub Copilot' }
  ])
  expect(await fs.readFile(file, 'utf8')).toContain('name: testes-unitarios-com-vitest')
  await expect(fs.stat(join(projectPath, '.agents'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('imported legacy Antigravity skills retain their .agent path through disable and restore', async () => {
  const skill = original.catalog.skills[0]
  skill.agents = ['Antigravity']
  const file = join(projectPath, '.agent/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  await fs.writeFile(file, '# Legacy Antigravity')
  skill.originPath = file
  await saveVaultData(root, original)
  const active = structuredClone(original)
  setProjectBindings(active.projects.projects[0], [{ skillId: skill.id, agent: 'Antigravity' }])
  await saveProjectSkills(root, original, active)
  expect(active.projects.projects[0].deployedSkills![0].agentDirectory).toBe('.agent')
  const disabled = structuredClone(active)
  setProjectBindings(disabled.projects.projects[0], [])
  await saveProjectSkills(root, active, disabled)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  const restored = structuredClone(disabled)
  setProjectBindings(restored.projects.projects[0], [{ skillId: skill.id, agent: 'Antigravity' }])
  await saveProjectSkills(root, disabled, restored)
  expect(await fs.readFile(file, 'utf8')).toBe('# Legacy Antigravity')
  await expect(fs.stat(join(projectPath, '.github'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('activation reuses an imported project Markdown without overwriting local edits', async () => {
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  await fs.writeFile(file, '# Imported skill\n\nLocal edits to preserve.\r\n')
  original.catalog.skills[0].originPath = file
  await saveVaultData(root, original)
  const before = await fs.readFile(file)

  const { data } = await activateSkill()

  expect(data.projects.projects[0].skillIds).toEqual([data.catalog.skills[0].id])
  expect(data.projects.projects[0].deployedSkills![0].directory).toBe('testes-unitarios-com-vitest')
  expect(data.catalog.skills[0].publishedFolders![0].owned).toBe(false)
  expect(await fs.readFile(file)).toEqual(before)
})

test('an imported project skill can be disabled and restored byte for byte', async () => {
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  const content = Buffer.from('# Imported skill\r\n\nPreserve my edits.\r\n')
  await fs.writeFile(file, content)
  original.catalog.skills[0].originPath = file
  await saveVaultData(root, original)
  const { data } = await activateSkill()
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []

  await saveProjectSkills(root, data, disabled)

  await expect(fs.stat(join(file, '..'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(disabled.catalog.skills[0].originPath).toBe(file)
  expect((await readVault(root)).projects.projects[0].skillIds).toEqual([])
  const enabled = structuredClone(disabled)
  enabled.projects.projects[0].skillIds = [enabled.catalog.skills[0].id]
  await saveProjectSkills(root, disabled, enabled)
  expect(await fs.readFile(file)).toEqual(content)
})

test('a failed save restores an imported project skill and its folder', async () => {
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  await fs.writeFile(file, '# Imported original')
  original.catalog.skills[0].originPath = file
  await saveVaultData(root, original)
  const { data } = await activateSkill()
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []

  await expect(saveProjectSkills(root, data, disabled, async () => {
    throw new Error('Metadata failed')
  })).rejects.toThrow('Metadata failed')
  expect(await fs.readFile(file, 'utf8')).toBe('# Imported original')
  expect(await readVault(root)).toEqual(data)
})

test('disabling refuses to remove a Markdown also used as another imported origin', async () => {
  const { data, file } = await activateSkill()
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  other.skill.originPath = file
  data.catalog.skills.push(other.skill)
  await writeSkillFile(root, other.skill.filePath, other.content)
  await saveVaultData(root, data)
  const content = await fs.readFile(file)
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []

  await expect(saveProjectSkills(root, data, disabled)).rejects.toThrow('origem importado')
  expect(await fs.readFile(file)).toEqual(content)
  expect(await readVault(root)).toEqual(data)
})

test('activation reuses matching existing content without claiming its folder', async () => {
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  const content = await fs.readFile(join(root, original.catalog.skills[0].filePath))
  await fs.writeFile(file, content)

  const { data } = await activateSkill()

  expect(await fs.readFile(file)).toEqual(content)
  expect(data.catalog.skills[0].publishedFolders![0].owned).toBe(false)
})

test('a metadata failure leaves a reused project Markdown untouched', async () => {
  const file = join(projectPath, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  await fs.mkdir(join(file, '..'), { recursive: true })
  const content = await fs.readFile(join(root, original.catalog.skills[0].filePath))
  await fs.writeFile(file, content)
  const next = structuredClone(original)
  next.projects.projects[0].skillIds = [next.catalog.skills[0].id]

  await expect(saveProjectSkills(root, original, next, async () => {
    throw new Error('Metadata failed')
  })).rejects.toThrow('Metadata failed')
  expect(await fs.readFile(file)).toEqual(content)
  expect(await readVault(root)).toEqual(original)
})

test('reactivation reuses a matching existing deployment and clears its archive', async () => {
  const { data, file } = await activateSkill()
  const published = await fs.readFile(file)
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, data, disabled)
  await fs.mkdir(join(file, '..'))
  await fs.writeFile(file, published)
  const next = structuredClone(disabled)
  next.projects.projects[0].skillIds = [next.catalog.skills[0].id]

  await saveProjectSkills(root, disabled, next)
  expect(await fs.readFile(file)).toEqual(published)
  const disabledAgain = structuredClone(next)
  disabledAgain.projects.projects[0].skillIds = []
  await expect(saveProjectSkills(root, next, disabledAgain)).resolves.toBeUndefined()
})

test('a different project file does not overwrite the archived version on reactivation', async () => {
  const { data, file } = await activateSkill()
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, data, disabled)
  await fs.mkdir(join(file, '..'))
  await fs.writeFile(file, '# Different project version')
  const next = structuredClone(disabled)
  next.projects.projects[0].skillIds = [next.catalog.skills[0].id]

  await expect(saveProjectSkills(root, disabled, next)).rejects.toThrow('difere da copia desativada')
  expect(await fs.readFile(file, 'utf8')).toBe('# Different project version')
  expect(await readVault(root)).toEqual(disabled)
})

test('disabling removes discovery and re-enabling preserves project edits byte for byte', async () => {
  const { data, file } = await activateSkill()
  const edited = Buffer.concat([await fs.readFile(file), Buffer.from('\nEdicoes locais\r\n')])
  await fs.writeFile(file, edited)
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, data, disabled)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(join(file, '..'))).rejects.toMatchObject({ code: 'ENOENT' })
  const directories = await fs.readdir(join(root, '.skillvortex/disabled-skills'))
  const archivedDirectory = join(root, '.skillvortex/disabled-skills', directories[0])
  const archivedFiles = await fs.readdir(archivedDirectory)
  expect(await fs.readFile(join(archivedDirectory, archivedFiles[0]))).toEqual(edited)
  const enabled = structuredClone(disabled)
  enabled.projects.projects[0].skillIds = [enabled.catalog.skills[0].id]
  enabled.catalog.skills[0].name = 'Renamed while disabled'
  await saveProjectSkills(root, disabled, enabled)
  expect(await fs.readFile(file)).toEqual(edited)
  const unrelated = structuredClone(enabled)
  unrelated.catalog.categories.push('Other')
  await saveProjectSkills(root, enabled, unrelated)
  const syncedDirectory = unrelated.projects.projects[0].deployedSkills![0].directory
  expect(syncedDirectory).toBe('renamed-while-disabled')
  const synced = await fs.readFile(join(projectPath, '.github/skills', syncedDirectory, 'SKILL.md'), 'utf8')
  expect(synced).toMatch(/^---\nname: renamed-while-disabled\n/)
  expect(synced).toContain('# Testes Unitários com Vitest')
  expect(synced).toContain('Edicoes locais')
})

test('saving active Markdown synchronizes unchanged generated files', async () => {
  const { data, file } = await activateSkill()
  await writeSkillFile(root, data.catalog.skills[0].filePath, '# New content')
  const next = structuredClone(data)
  await saveProjectSkills(root, data, next)
  expect(await fs.readFile(file, 'utf8')).toContain('# New content')
})

test('unrelated metadata changes do not fail when an unchanged active deployment is missing', async () => {
  const { data, file } = await activateSkill()
  await fs.unlink(file)
  const next = structuredClone(data)
  next.catalog.categories.push('Other')

  await expect(saveProjectSkills(root, data, next)).resolves.toBeUndefined()
  expect(await readVault(root)).toEqual(next)
})

test('disabling a deployment whose project Markdown is missing still clears the active link', async () => {
  const { data, file } = await activateSkill()
  await fs.unlink(file)
  const next = structuredClone(data)
  next.projects.projects[0].skillIds = []

  await expect(saveProjectSkills(root, data, next)).resolves.toBeUndefined()
  expect(next.projects.projects[0].deployedSkills).toEqual([])
  await expect(fs.stat(join(file, '..'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readVault(root)).toEqual(next)
})

test('renaming an active skill updates its published folder and slash command name', async () => {
  const { data, file } = await activateSkill()
  const next = structuredClone(data)
  next.catalog.skills[0].name = 'Verifica consistência do HTML'
  next.catalog.skills[0].description = 'Verifica estrutura e acessibilidade de documentos HTML.'

  await saveProjectSkills(root, data, next)

  const deployed = next.projects.projects[0].deployedSkills![0]
  const renamed = join(projectPath, '.github/skills', 'verifica-consistencia-do-html', 'SKILL.md')
  expect(deployed.directory).toBe('verifica-consistencia-do-html')
  expect(next.catalog.skills[0].publishedFolders?.map(folder => folder.directory))
    .toEqual(['verifica-consistencia-do-html'])
  expect(await fs.readFile(renamed, 'utf8')).toMatch(
    /^---\nname: verifica-consistencia-do-html\ndescription: ".+"\n---/
  )
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('renaming a published folder does not move another imported origin', async () => {
  const { data, file } = await activateSkill()
  const origin = join(file, '..', 'imported.md')
  await fs.writeFile(origin, 'Original')
  const next = structuredClone(data)
  next.catalog.skills[0].name = 'Another name'
  const other = createDocumentedExamples()[1].skill
  other.category = 'Geral'
  other.originPath = origin
  next.catalog.skills.push(other)
  await expect(saveProjectSkills(root, data, next)).rejects.toThrow('origem importado')
  expect(await fs.readFile(origin, 'utf8')).toBe('Original')
  expect(await fs.readFile(file, 'utf8')).toContain('Testes Unitários com Vitest')
})

test('saving never overwrites a skill edited in the project', async () => {
  const { data, file } = await activateSkill()
  await fs.writeFile(file, '# Local edit')
  await writeSkillFile(root, data.catalog.skills[0].filePath, '# Vault edit')
  await expect(saveProjectSkills(root, data, structuredClone(data))).rejects.toThrow('editada')
  expect(await fs.readFile(file, 'utf8')).toBe('# Local edit')
  expect(await readVault(root)).toEqual(data)
})

test('metadata failure rolls back activation without overwriting existing files', async () => {
  const data = structuredClone(original)
  data.projects.projects[0].skillIds = [data.catalog.skills[0].id]
  await expect(saveProjectSkills(root, original, data, async () => {
    throw new Error('Metadata failed')
  })).rejects.toThrow('Metadata failed')
  expect(await readVault(root)).toEqual(original)
  const dir = data.projects.projects[0].deployedSkills![0].directory
  const file = join(projectPath, '.github/skills', dir, 'SKILL.md')
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  await fs.mkdir(join(projectPath, '.github/skills', dir))
  await fs.writeFile(file, '# User file')
  const retry = structuredClone(original)
  retry.projects.projects[0].skillIds = [retry.catalog.skills[0].id]
  await expect(saveProjectSkills(root, original, retry)).rejects.toThrow('Ja existe outro SKILL.md')
  expect(await fs.readFile(file, 'utf8')).toBe('# User file')
})

test('metadata failure while disabling restores the edited active file', async () => {
  const { data, file } = await activateSkill()
  await fs.writeFile(file, '# Keep my changes')
  const next = structuredClone(data)
  next.projects.projects[0].skillIds = []
  await expect(saveProjectSkills(root, data, next, async () => {
    throw new Error('Metadata failed')
  })).rejects.toThrow('Metadata failed')
  expect(await fs.readFile(file, 'utf8')).toBe('# Keep my changes')
  expect(await readVault(root)).toEqual(data)
  await saveProjectSkills(root, data, next)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('disabling a legacy deployment removes its empty folder without claiming unrelated content', async () => {
  const { data, file } = await activateSkill()
  delete data.catalog.skills[0].publishedFolders
  await saveVaultData(root, data)
  const disabled = structuredClone(data)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, data, disabled)
  await expect(fs.stat(join(file, '..'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test.each(['blocked', 'unlinked', 'deleted-project'])('%s preserves published files outside the project', async action => {
  const { data, file } = await activateSkill()
  const next = structuredClone(data)
  next.projects.projects[0].skillIds = []
  if (action === 'blocked') next.catalog.skills[0].status = 'blocked'
  if (action === 'unlinked') next.catalog.skills = []
  if (action === 'deleted-project') {
    next.projects.projects = []
    next.projects.activeProject = null
  }
  await saveProjectSkills(root, data, next)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('changing the associated folder transfers the preserved skill to the new project', async () => {
  const { data, file } = await activateSkill()
  const edited = '# Edited before moving'
  await fs.writeFile(file, edited)
  const newPath = join(temporary, 'new-project')
  await fs.mkdir(newPath)
  const next = structuredClone(data)
  next.projects.projects[0].sourcePath = newPath
  await saveProjectSkills(root, data, next)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(join(newPath, '.github/skills',
    next.projects.projects[0].deployedSkills![0].directory, 'SKILL.md'), 'utf8')).toBe(edited)
  expect(next.catalog.skills[0].publishedFolders?.map(folder => folder.projectPath).sort()).toEqual(
    [await fs.realpath(projectPath), await fs.realpath(newPath)].sort()
  )
})

test('refuses symbolic directories and vaults inside the project', async () => {
  await fs.symlink(root, join(projectPath, '.github'))
  await expect(activateSkill()).rejects.toThrow('simbolico')
  await fs.unlink(join(projectPath, '.github'))
  original.projects.projects[0].sourcePath = temporary
  await expect(activateSkill()).rejects.toThrow('fora da pasta do projeto')
})

test('legacy links without a folder do not block unrelated metadata changes', async () => {
  delete original.projects.projects[0].sourcePath
  original.projects.projects[0].skillIds = [original.catalog.skills[0].id]
  await saveVaultData(root, original)
  const next = structuredClone(original)
  next.catalog.categories.push('Other')
  await saveProjectSkills(root, original, next)
  expect(await readVault(root)).toEqual(next)
  const newlyLinked = structuredClone(original)
  newlyLinked.projects.projects.push({ id: 'new', name: 'New', skillIds: [original.catalog.skills[0].id] })
  await expect(saveProjectSkills(root, original, newlyLinked)).rejects.toThrow('Associe uma pasta')
})

test('restoring a backup also deactivates and restores the project file', async () => {
  const disabledBackup = await createVaultBackup(root)
  const { file } = await activateSkill()
  const enabledBackup = await createVaultBackup(root)
  const save = async (path: string, next: VaultData) => saveProjectSkills(path, await readVault(path), next)
  await restoreVaultBackup(root, disabledBackup.id, save)
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await readVault(root)).catalog.skills[0].publishedFolders).toHaveLength(1)
  await restoreVaultBackup(root, enabledBackup.id, save)
  expect(await fs.readFile(file, 'utf8')).toContain('Testes Unitários com Vitest')
})
