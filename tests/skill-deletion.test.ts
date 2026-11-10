import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createDocumentedExamples } from '../src/documented-examples'
import { saveProjectSkills } from '../src/project-skills'
import { deleteCollectionFiles, deleteSkillFiles, planSkillDeletion } from '../src/skill-deletion'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'
import { skillCards, type VaultData } from '../src/model'

let temporary: string
let root: string
let projects: string[]
let origin: string
let initial: VaultData

beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-delete-'))
  root = join(temporary, 'vault')
  projects = [join(temporary, 'first'), join(temporary, 'second')]
  await Promise.all(projects.map(path => fs.mkdir(path)))
  origin = join(temporary, 'imported.md')
  await fs.writeFile(origin, '# Original import')
  await createVault(root)
  initial = await readVault(root)
  const example = createDocumentedExamples()[7]
  example.skill.category = 'Geral'
  example.skill.originPath = origin
  initial.catalog.skills.push(example.skill)
  initial.projects.projects = projects.map((sourcePath, index) => ({
    id: `project-${index}`, name: `Project ${index}`, sourcePath, skillIds: []
  }))
  initial.projects.activeProject = 'project-0'
  await writeSkillFile(root, example.skill.filePath, example.content)
  await saveVaultData(root, initial)
})

afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })

async function disabledSkill(): Promise<VaultData> {
  const active = structuredClone(initial)
  for (const project of active.projects.projects) project.skillIds = [active.catalog.skills[0].id]
  await saveProjectSkills(root, initial, active)
  for (const folder of active.catalog.skills[0].publishedFolders!) {
    await fs.writeFile(join(folder.projectPath, '.github/skills', folder.directory, 'extra.txt'), 'Extra')
  }
  const disabled = structuredClone(active)
  for (const project of disabled.projects.projects) project.skillIds = []
  await saveProjectSkills(root, active, disabled)
  return disabled
}

const persist = async (path: string, data: VaultData) =>
  saveProjectSkills(path, await readVault(path), data)

test('deleting a card preserves skills exclusive to other cards without generating standalone cards', async () => {
  const first = initial.catalog.skills[0]
  const shared = { ...first, id: 'shared', name: 'Shared', filePath: 'skills/shared.md' }
  initial.catalog.skills.push(shared)
  await writeSkillFile(root, shared.filePath, '# Shared')
  initial.catalog.collections = [
    { id: 'first', name: 'First', skillIds: [first.id] },
    { id: 'second', name: 'Second', skillIds: [shared.id] },
    { id: 'third', name: 'Third', skillIds: [] },
    { id: 'fourth', name: 'Fourth', skillIds: [] }
  ]
  await saveVaultData(root, initial)
  const plan = await planSkillDeletion(root, initial, first)
  await deleteCollectionFiles(root, 'first', [plan], persist)
  const saved = await readVault(root)
  expect(skillCards(saved.catalog).map(card => card.id)).toEqual(['second', 'third', 'fourth'])
  expect(saved.catalog.skills.map(skill => skill.id)).toEqual(['shared'])
  expect(await fs.readFile(join(root, shared.filePath), 'utf8')).toBe('# Shared')
  await expect(fs.stat(join(root, first.filePath))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(origin, 'utf8')).toBe('# Original import')
})

test('a failed card deletion restores every exclusive Markdown and the card metadata', async () => {
  const first = initial.catalog.skills[0]
  const second = { ...first, id: 'second', name: 'Second', filePath: 'skills/second.md' }
  initial.catalog.skills.push(second)
  await writeSkillFile(root, second.filePath, '# Second')
  initial.catalog.collections = [{ id: 'card', name: 'Card', skillIds: [first.id, second.id] }]
  await saveVaultData(root, initial)
  const content = await fs.readFile(join(root, first.filePath))
  const plans = await Promise.all(initial.catalog.skills.map(skill => planSkillDeletion(root, initial, skill)))
  await expect(deleteCollectionFiles(root, 'card', plans, async () => { throw new Error('Save failed') }))
    .rejects.toThrow('Save failed')
  expect(await readVault(root)).toEqual(initial)
  expect(await fs.readFile(join(root, first.filePath))).toEqual(content)
  expect(await fs.readFile(join(root, second.filePath), 'utf8')).toBe('# Second')
  expect((await fs.readdir(join(root, 'skills'))).some(name => name.includes('skillvortex-delete'))).toBe(false)
})

test('moving membership after confirmation prevents deleting a skill in another card', async () => {
  const skill = initial.catalog.skills[0]
  initial.catalog.collections = [{ id: 'card', name: 'Card', skillIds: [skill.id] }]
  await saveVaultData(root, initial)
  const plan = await planSkillDeletion(root, initial, skill)
  initial.catalog.collections[0].skillIds = []
  initial.catalog.collections.push({ id: 'other', name: 'Other', skillIds: [skill.id] })
  await saveVaultData(root, initial)
  await expect(deleteCollectionFiles(root, 'card', [plan], persist)).rejects.toThrow('mudaram apos')
  expect(await readVault(root)).toEqual(initial)
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toContain('Vitest')
})

async function addLegacyMarker(data: VaultData, folderIndex = 0): Promise<void> {
  const skill = data.catalog.skills[0]
  const folder = skill.publishedFolders![folderIndex]
  folder.marker = 'a'.repeat(32)
  await fs.writeFile(
    join(folder.projectPath, '.github/skills', folder.directory, `.skillvortex-${folder.marker}`),
    skill.id
  )
}

test('deletes all recorded project folders and archives while preserving imported and unrelated files', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const folders = skill.publishedFolders!
  expect(folders).toHaveLength(2)
  for (const folder of folders) {
    const path = join(folder.projectPath, '.github/skills', folder.directory)
    await fs.mkdir(join(path, 'nested'))
    await fs.writeFile(join(path, 'nested', 'extra.md'), 'Extra content')
  }
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  data.catalog.skills.push(other.skill)
  await writeSkillFile(root, other.skill.filePath, other.content)
  await saveVaultData(root, data)
  const plan = await planSkillDeletion(root, data, skill)
  expect(plan.folders).toHaveLength(2)
  expect(plan.archives).toHaveLength(2)

  await deleteSkillFiles(root, plan, persist)

  expect((await readVault(root)).catalog.skills.map(item => item.id)).toEqual([other.skill.id])
  await expect(fs.stat(join(root, skill.filePath))).rejects.toMatchObject({ code: 'ENOENT' })
  for (const path of [...plan.folders, ...plan.archives]) {
    await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  }
  expect(await fs.readFile(origin, 'utf8')).toBe('# Original import')
  expect(await fs.readFile(join(root, other.skill.filePath), 'utf8')).toBe(other.content)
})

test('a metadata failure restores folders, archive files and vault Markdown', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const plan = await planSkillDeletion(root, data, skill)
  await fs.writeFile(join(plan.folders[0], 'extra.txt'), 'Keep')
  const originalMarkdown = await fs.readFile(plan.vaultFile)
  const archives = await Promise.all(plan.archives.map(path => fs.readFile(path)))

  await expect(deleteSkillFiles(root, plan, async () => {
    throw new Error('Metadata failed')
  })).rejects.toThrow('Metadata failed')

  expect(await readVault(root)).toEqual(data)
  expect(await fs.readFile(plan.vaultFile)).toEqual(originalMarkdown)
  expect(await fs.readFile(join(plan.folders[0], 'extra.txt'), 'utf8')).toBe('Keep')
  for (let index = 0; index < plan.archives.length; index++) {
    expect(await fs.readFile(plan.archives[index])).toEqual(archives[index])
  }
  for (const path of [...projects.map(path => join(path, '.github/skills')), join(root, 'skills')]) {
    expect((await fs.readdir(path)).some(name => name.includes('.skillvortex-delete-'))).toBe(false)
  }
})

test('preserves staged files and reports a failure if metadata was committed before an error', async () => {
  const data = await disabledSkill()
  const plan = await planSkillDeletion(root, data, data.catalog.skills[0])

  await expect(deleteSkillFiles(root, plan, async (path, next) => {
    await saveVaultData(path, next)
    throw new Error('Temporary cleanup failed')
  })).rejects.toThrow('Cadastro removido, mas houve uma falha')

  expect((await readVault(root)).catalog.skills).toHaveLength(0)
  for (const folder of plan.folders) {
    const siblings = await fs.readdir(join(folder, '..'))
    expect(siblings.some(name => name.includes('.skillvortex-delete-'))).toBe(true)
  }
  const vaultFiles = await fs.readdir(join(root, 'skills'))
  expect(vaultFiles.some(name => name.includes('.skillvortex-delete-'))).toBe(true)
  expect(await fs.readFile(origin, 'utf8')).toBe('# Original import')
})

test('refuses deletion while the skill is active in any project', async () => {
  const active = structuredClone(initial)
  active.projects.projects[1].skillIds = [active.catalog.skills[0].id]
  await saveProjectSkills(root, initial, active)
  await expect(planSkillDeletion(root, active, active.catalog.skills[0])).rejects.toThrow('todos os projetos')
})

test('refuses to delete an imported origin inside a published folder, including another skill origin', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const folder = skill.publishedFolders![0]
  const nestedOrigin = join(folder.projectPath, '.github/skills', folder.directory, 'original.md')
  await fs.writeFile(nestedOrigin, 'Keep original')
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  other.skill.originPath = nestedOrigin
  data.catalog.skills.push(other.skill)
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('origem importado')
  expect(await fs.readFile(nestedOrigin, 'utf8')).toBe('Keep original')
})

test('accepts home-relative origin paths used by desktop migrations', async () => {
  const data = await disabledSkill()
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  other.skill.originPath = '~/skillvortex-test-origin-that-does-not-exist.md'
  data.catalog.skills.push(other.skill)
  await expect(planSkillDeletion(root, data, data.catalog.skills[0])).resolves.toMatchObject({
    folders: expect.any(Array), archives: expect.any(Array)
  })
})

test('refuses a published folder whose ownership marker was removed or altered', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const folder = skill.publishedFolders![0]
  const path = join(folder.projectPath, '.github/skills', folder.directory)
  await addLegacyMarker(data)
  await fs.unlink(join(path, `.skillvortex-${folder.marker}`))
  await fs.writeFile(join(path, 'unrelated.txt'), 'Keep')
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('Identificacao')
  expect(await fs.readFile(join(path, 'unrelated.txt'), 'utf8')).toBe('Keep')
})

test('a missing marker does not trap an active skill: it can be disabled without claiming the folder', async () => {
  const active = structuredClone(initial)
  active.projects.projects[0].skillIds = [active.catalog.skills[0].id]
  await saveProjectSkills(root, initial, active)
  await addLegacyMarker(active)
  const folder = active.catalog.skills[0].publishedFolders![0]
  const path = join(folder.projectPath, '.github/skills', folder.directory)
  await fs.unlink(join(path, `.skillvortex-${folder.marker}`))
  await fs.writeFile(join(path, 'keep.txt'), 'Keep')
  const disabled = structuredClone(active)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, active, disabled)
  expect(disabled.catalog.skills[0].publishedFolders?.[0].owned).toBe(false)
  await expect(planSkillDeletion(root, disabled, disabled.catalog.skills[0])).rejects.toThrow('nao foi identificada')
  expect(await fs.readFile(join(path, 'keep.txt'), 'utf8')).toBe('Keep')
})

test('refuses a symbolic published folder without touching its target', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const folder = skill.publishedFolders![0]
  const path = join(folder.projectPath, '.github/skills', folder.directory)
  const moved = `${path}-moved`
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'keep.txt'), 'Keep')
  await fs.rename(path, moved)
  await fs.symlink(outside, path, 'dir')
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('simbolico')
  expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('Keep')
})

test('deleting a generated folder does not follow symbolic links inside it', async () => {
  const data = await disabledSkill()
  const plan = await planSkillDeletion(root, data, data.catalog.skills[0])
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'keep.txt'), 'Keep')
  await fs.symlink(outside, join(plan.folders[0], 'external'), 'dir')
  await deleteSkillFiles(root, plan, persist)
  expect(await fs.readFile(join(outside, 'keep.txt'), 'utf8')).toBe('Keep')
})

test('refuses a project path redirected through a symbolic link', async () => {
  const data = await disabledSkill()
  const folder = data.catalog.skills[0].publishedFolders![0]
  const originalPath = folder.projectPath
  await fs.rename(originalPath, `${originalPath}-moved`)
  await fs.symlink(`${originalPath}-moved`, originalPath, 'dir')
  await expect(planSkillDeletion(root, data, data.catalog.skills[0])).rejects.toThrow('redirecionada')
})

test('does not claim or recursively delete a folder that existed before publication', async () => {
  const folder = join(projects[0], '.github/skills/testes-unitarios-com-vitest')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(join(folder, 'existing.txt'), 'Keep')
  const data = await disabledSkill()
  expect(data.catalog.skills[0].publishedFolders?.find(item => item.projectId === 'project-0')?.owned).toBe(false)
  await expect(planSkillDeletion(root, data, data.catalog.skills[0])).rejects.toThrow('nao foi identificada')
  expect(await fs.readFile(join(folder, 'existing.txt'), 'utf8')).toBe('Keep')
})

test('a removed pre-existing folder can be recreated and safely registered on reactivation', async () => {
  const folder = join(projects[0], '.github/skills/testes-unitarios-com-vitest')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(join(folder, 'existing.txt'), 'Moved away by the user')
  const disabled = await disabledSkill()
  await fs.unlink(join(folder, 'existing.txt'))
  await fs.unlink(join(folder, 'extra.txt'))
  await fs.rmdir(folder)
  const active = structuredClone(disabled)
  active.projects.projects[0].skillIds = [active.catalog.skills[0].id]
  await saveProjectSkills(root, disabled, active)
  const owned = active.catalog.skills[0].publishedFolders!.find(item => item.projectId === 'project-0')!
  expect(owned.owned).toBe(true)
  expect(owned.marker).toBeUndefined()
  expect((await fs.readdir(folder)).some(name => name.startsWith('.skillvortex-'))).toBe(false)
  const again = structuredClone(active)
  again.projects.projects[0].skillIds = []
  await saveProjectSkills(root, active, again)
  const plan = await planSkillDeletion(root, again, again.catalog.skills[0])
  await deleteSkillFiles(root, plan, persist)
  await expect(fs.stat(folder)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('refuses legacy archives when their original folder cannot be identified safely', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  delete skill.publishedFolders
  await saveVaultData(root, data)
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('versao antiga')
  expect(await readVault(root)).toEqual(data)
})

test('detects an old archive even if its project was removed from the catalog', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  skill.publishedFolders = skill.publishedFolders!.filter(folder => folder.projectId !== 'project-0')
  data.projects.projects = data.projects.projects.filter(project => project.id !== 'project-0')
  data.projects.activeProject = 'project-1'
  await saveVaultData(root, data)
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('arquivo arquivado')
  expect(await readVault(root)).toEqual(data)
})

test('does not assume a legacy active deployment owns its pre-existing folder', async () => {
  const active = structuredClone(initial)
  active.projects.projects[0].skillIds = [active.catalog.skills[0].id]
  await saveProjectSkills(root, initial, active)
  await addLegacyMarker(active)
  const folder = active.catalog.skills[0].publishedFolders![0]
  const path = join(folder.projectPath, '.github/skills', folder.directory)
  await fs.unlink(join(path, `.skillvortex-${folder.marker}`))
  await fs.writeFile(join(path, 'old-file.txt'), 'Keep')
  delete active.catalog.skills[0].publishedFolders
  await saveVaultData(root, active)
  const disabled = structuredClone(active)
  disabled.projects.projects[0].skillIds = []
  await saveProjectSkills(root, active, disabled)
  expect(disabled.catalog.skills[0].publishedFolders?.[0].owned).toBe(false)
  await expect(planSkillDeletion(root, disabled, disabled.catalog.skills[0])).rejects.toThrow('nao foi identificada')
  expect(await fs.readFile(join(path, 'old-file.txt'), 'utf8')).toBe('Keep')
})

test('refuses a folder also recorded by another skill', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  other.skill.publishedFolders = [structuredClone(skill.publishedFolders![0])]
  data.catalog.skills.push(other.skill)
  await expect(planSkillDeletion(root, data, skill)).rejects.toThrow('outra skill')
})

test('reserves an inactive skill folder when another unique title has the same slug', async () => {
  const data = await disabledSkill()
  const first = data.catalog.skills[0]
  const other = createDocumentedExamples()[1]
  other.skill.category = 'Geral'
  other.skill.name = `${first.name}!`
  data.catalog.skills.push(other.skill)
  await writeSkillFile(root, other.skill.filePath, other.content)
  const next = structuredClone(data)
  next.projects.projects[0].skillIds = [other.skill.id]
  await saveProjectSkills(root, data, next)
  expect(next.projects.projects[0].deployedSkills![0].directory).toBe('testes-unitarios-com-vitest-2')
  const otherFile = join(projects[0], '.github/skills/testes-unitarios-com-vitest-2/SKILL.md')
  const plan = await planSkillDeletion(root, next, next.catalog.skills[0])
  await deleteSkillFiles(root, plan, persist)
  expect(await fs.readFile(otherFile, 'utf8')).toContain(other.skill.description)
})

test('detects changed files after confirmation before moving anything', async () => {
  const data = await disabledSkill()
  const skill = data.catalog.skills[0]
  const plan = await planSkillDeletion(root, data, skill)
  await fs.rename(plan.folders[0], `${plan.folders[0]}-moved`)
  await expect(deleteSkillFiles(root, plan, persist)).rejects.toThrow('mudaram apos a confirmacao')
  expect(await readVault(root)).toEqual(data)
  expect(await fs.readFile(origin, 'utf8')).toBe('# Original import')
})
