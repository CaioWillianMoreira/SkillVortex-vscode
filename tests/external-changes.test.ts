import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createDocumentedExamples } from '../src/documented-examples'
import { detectExternalChanges, inspectSkillVersions, resolveExternalChange } from '../src/external-changes'
import { setSharedSkillPublication, type VaultData } from '../src/model'
import { saveProjectSkills } from '../src/project-skills'
import { createVault, readVault, saveVaultData, writeSkillFile } from '../src/vault'

let temporary: string
let root: string
let project: string
let data: VaultData
let skillId: string
let library: string
let copilot: string
let antigravity: string

beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-external-'))
  root = join(temporary, 'library')
  project = join(temporary, 'project')
  await fs.mkdir(project)
  await createVault(root)
  root = await fs.realpath(root)
  project = await fs.realpath(project)
  const previous = await readVault(root)
  const example = createDocumentedExamples()[7]
  example.skill.category = 'Geral'
  skillId = example.skill.id
  previous.catalog.skills.push(example.skill)
  previous.projects.projects.push({ id: 'project', name: 'Project', sourcePath: project, skillIds: [] })
  await writeSkillFile(root, example.skill.filePath, example.content)
  await saveVaultData(root, previous)
  data = structuredClone(previous)
  setSharedSkillPublication(data.projects.projects[0], skillId, true)
  await saveProjectSkills(root, previous, data)
  library = join(root, example.skill.filePath)
  copilot = join(project, '.github/skills/testes-unitarios-com-vitest/SKILL.md')
  antigravity = join(project, '.agents/skills/testes-unitarios-com-vitest/SKILL.md')
})

afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })

test('unchanged publications do not report false external edits', async () => {
  expect(await detectExternalChanges(root, data)).toEqual([])
})

test('detects independent library and publication edits, then restores with complete recovery snapshots', async () => {
  await fs.appendFile(library, '\nLibrary edit')
  await fs.appendFile(copilot, '\nCopilot edit')
  await fs.appendFile(antigravity, '\nAntigravity edit')
  const before = await Promise.all([library, copilot, antigravity].map(file => fs.readFile(file, 'utf8')))
  const [change] = await detectExternalChanges(root, data)
  expect(change.library.changed).toBe(true)
  expect(change.publications.map(version => version.changed)).toEqual([true, true])
  const backup = await resolveExternalChange(root, change, library)
  const manifest: Array<{ path: string; snapshot: string }> = JSON.parse(await fs.readFile(join(backup, 'manifest.json'), 'utf8'))
  for (const [index, path] of [library, copilot, antigravity].entries()) {
    const entry = manifest.find(item => item.path === path)!
    expect(await fs.readFile(join(backup, entry.snapshot), 'utf8')).toBe(before[index])
  }
  expect(await fs.readFile(copilot)).toEqual(await fs.readFile(antigravity))
  expect(await fs.readFile(copilot, 'utf8')).toContain('Library edit')
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test('imports the explicitly selected project edit and synchronizes every active copy', async () => {
  await fs.appendFile(copilot, '\nChosen edit')
  await fs.appendFile(antigravity, '\nOther edit')
  const selected = await fs.readFile(copilot, 'utf8')
  const [change] = await detectExternalChanges(root, data)
  await resolveExternalChange(root, change, copilot)
  expect(await fs.readFile(library, 'utf8')).toBe(selected)
  expect(await fs.readFile(antigravity, 'utf8')).toContain('Chosen edit')
  expect(await fs.readFile(antigravity, 'utf8')).not.toContain('Other edit')
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test('rejects stale reviewed versions without writing anything', async () => {
  await fs.appendFile(copilot, '\nFirst edit')
  const [change] = await detectExternalChanges(root, data)
  await fs.appendFile(copilot, '\nLater edit')
  const original = await fs.readFile(library)
  await expect(resolveExternalChange(root, change, copilot)).rejects.toThrow('mudaram apos')
  expect(await fs.readFile(library)).toEqual(original)
  expect(await fs.readFile(copilot, 'utf8')).toContain('Later edit')
})

test('rejects changes to catalog metadata after review even if Markdown is unchanged', async () => {
  await fs.appendFile(copilot, '\nExternal edit')
  const [change] = await detectExternalChanges(root, data)
  const modified = await readVault(root)
  modified.catalog.skills[0].description = 'Changed independently'
  await saveVaultData(root, modified)
  await expect(resolveExternalChange(root, change, copilot)).rejects.toThrow('mudaram apos')
  expect(await readVault(root)).toEqual(modified)
})

test('does not undo a successful metadata commit when its callback subsequently reports an error', async () => {
  await fs.appendFile(copilot, '\nAdopted edit')
  const [change] = await detectExternalChanges(root, data)
  await expect(resolveExternalChange(root, change, copilot, async (path, next) => {
    await saveVaultData(path, next)
    throw new Error('Failure after commit')
  })).rejects.toThrow('confirmacao falhou')
  expect(await fs.readFile(library, 'utf8')).toContain('Adopted edit')
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test('rolls back library and all publications if metadata cannot be saved', async () => {
  await fs.appendFile(copilot, '\nExternal edit')
  const before = await Promise.all([library, copilot, antigravity].map(file => fs.readFile(file)))
  const [change] = await detectExternalChanges(root, data)
  await expect(resolveExternalChange(root, change, copilot, async () => { throw new Error('Save failed') }))
    .rejects.toThrow('Save failed')
  expect(await Promise.all([library, copilot, antigravity].map(file => fs.readFile(file)))).toEqual(before)
  expect(await readVault(root)).toEqual(data)
})

test('detects missing publication and restores it without losing the remaining copy', async () => {
  await fs.unlink(copilot)
  const [change] = await detectExternalChanges(root, data)
  expect(change.publications.find(version => version.agent === 'GitHub Copilot')?.content).toBeNull()
  await resolveExternalChange(root, change, library)
  expect(await fs.readFile(copilot)).toEqual(await fs.readFile(antigravity))
})

test('refuses symlinked publications instead of following them outside the project', async () => {
  await fs.unlink(copilot)
  await fs.symlink(library, copilot)
  await expect(detectExternalChanges(root, data)).rejects.toThrow('simbolico')
})

test('recovers a removed original by adopting a publication with a dedicated recovery snapshot', async () => {
  const content = await fs.readFile(copilot, 'utf8')
  await fs.unlink(library)
  const [change] = await detectExternalChanges(root, data)
  expect(change.library.content).toBeNull()
  const recovery = await resolveExternalChange(root, change, copilot)
  expect(recovery).toContain('external-recovery-')
  expect(await fs.readFile(library, 'utf8')).toBe(content)
  expect(JSON.parse(await fs.readFile(join(recovery, 'metadata.json'), 'utf8'))).toEqual(data)
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test('a malformed library can be restored by explicitly adopting a valid publication', async () => {
  await fs.writeFile(library, '---\nname: [invalid\n---')
  const [change] = await detectExternalChanges(root, data)
  expect(change.library.error).toContain('YAML invalido')
  await resolveExternalChange(root, change, copilot)
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test('an unavailable project is reported without blocking library inspection or recreating the project', async () => {
  const moved = join(temporary, 'moved-project')
  await fs.rename(project, moved)
  const [change] = await detectExternalChanges(root, data)
  expect(change.publications[0].error).toContain('indisponivel')
  await expect(resolveExternalChange(root, change, library)).rejects.toThrow('indisponivel')
  await expect(fs.stat(project)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(library, 'utf8')).toContain('Vitest')
})

test('inactive library changes can be reviewed using a captured in-session baseline', async () => {
  const disabled = structuredClone(data)
  setSharedSkillPublication(disabled.projects.projects[0], skillId, false)
  await saveProjectSkills(root, data, disabled)
  await fs.appendFile(library, '\nInactive edit')
  const change = await inspectSkillVersions(root, disabled, skillId)
  change.library.changed = true
  await resolveExternalChange(root, change, library)
  expect(await fs.readFile(library, 'utf8')).toContain('Inactive edit')
})
