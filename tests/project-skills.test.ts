import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'
import { saveProjectSkills } from '../src/project-skills'
import { createDocumentedExamples } from '../src/documented-examples'
import { createVaultBackup, restoreVaultBackup } from '../src/backup'
import type { VaultData } from '../src/model'

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

test('the pending Vitest example is published as a discoverable Copilot skill', async () => {
  const { data, file } = await activateSkill()
  const content = await fs.readFile(file, 'utf8')
  expect(content).toMatch(/^---\nname: testes-unitarios-com-vitest\ndescription: ".+"\n---\n\n# Testes Unitários com Vitest/)
  expect(data.projects.projects[0].deployedSkills![0].directory).toBe('testes-unitarios-com-vitest')
  expect(data.catalog.skills[0].status).toBe('pending')
  expect(await readVault(root)).toEqual(data)
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
  await expect(saveProjectSkills(root, original, retry)).rejects.toMatchObject({ code: 'EEXIST' })
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
  const folder = data.catalog.skills[0].publishedFolders![0]
  await fs.unlink(join(file, '..', `.skillvortex-${folder.marker}`))
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
