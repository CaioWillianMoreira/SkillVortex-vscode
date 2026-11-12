import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createDocumentedExamples } from '../src/documented-examples'
import { detectExternalChanges, inspectSkillVersions, resolveExternalChange } from '../src/external-changes'
import { setProjectBindings, setSharedSkillPublication, type VaultData } from '../src/model'
import { saveProjectSkills, skillPublicationMarkdown } from '../src/project-skills'
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

test('custom Markdown paths are monitored and synchronized without adding frontmatter or SKILL.md files', async () => {
  const disabled = structuredClone(data)
  setProjectBindings(disabled.projects.projects[0], [])
  await saveProjectSkills(root, data, disabled)
  disabled.catalog.skills[0].publicationPath = '.agents/instructions/nested/11-carga.md'
  await saveVaultData(root, disabled)
  const enabled = structuredClone(disabled)
  setSharedSkillPublication(enabled.projects.projects[0], skillId, true)
  await saveProjectSkills(root, disabled, enabled)
  const files = ['.github', '.agents'].map(folder =>
    join(project, folder, 'instructions/nested/11-carga.md'))
  expect(await detectExternalChanges(root, enabled)).toEqual([])
  await fs.writeFile(files[0], '# Custom edit\n\nChosen instructions.\r\n')
  const [change] = await detectExternalChanges(root, enabled)
  expect(change.publications.map(version => version.path).sort()).toEqual([...files].sort())
  await resolveExternalChange(root, change, files[0])
  for (const file of [library, ...files]) {
    expect(await fs.readFile(file, 'utf8')).toBe('# Custom edit\n\nChosen instructions.\r\n')
  }
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
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

test.each(
  [1, 2].flatMap(projects => ['library', 'copilot', 'antigravity'].flatMap(source =>
    ['lf', 'crlf', 'unicode'].map(format => ({ projects, source, format }))))
)('synchronization matrix: $projects project(s), $source source, $format content', async scenario => {
  if (scenario.projects === 2) {
    const secondPath = join(temporary, 'second-project')
    await fs.mkdir(secondPath)
    const previous = await readVault(root)
    const next = structuredClone(previous)
    next.projects.projects.push({ id: 'second', name: 'Second', sourcePath: secondPath, skillIds: [] })
    setSharedSkillPublication(next.projects.projects[1], skillId, true)
    await saveProjectSkills(root, previous, next)
    data = await readVault(root)
  }
  const paths = { library, copilot, antigravity }
  const source = paths[scenario.source as keyof typeof paths]
  const body = scenario.format === 'unicode' ? '# Revisao\n\nConteudo: ação, 日本語, 🚀.\n' : '# Revision\n\nMerged content.\n'
  const content = scenario.format === 'crlf' ? body.replace(/\n/g, '\r\n') : body
  await fs.writeFile(source, content)
  const [change] = await detectExternalChanges(root, data)
  expect(change.publications).toHaveLength(scenario.projects * 2)
  const before = await Promise.all([change.library, ...change.publications].map(version => fs.readFile(version.path, 'utf8')))
  const recovery = await resolveExternalChange(root, change, source)
  expect(await fs.readFile(library, 'utf8')).toBe(content)
  const saved = await readVault(root)
  expect(await detectExternalChanges(root, saved)).toEqual([])
  for (const version of change.publications) {
    expect(await fs.readFile(version.path, 'utf8')).toContain(content)
  }
  const manifest: Array<{ path: string; snapshot: string }> = JSON.parse(await fs.readFile(join(recovery, 'manifest.json'), 'utf8'))
  for (const [index, version] of [change.library, ...change.publications].entries()) {
    const snapshot = manifest.find(entry => entry.path === version.path)!
    expect(await fs.readFile(join(recovery, snapshot.snapshot), 'utf8')).toBe(before[index])
  }
  const disabled = structuredClone(saved)
  for (const project of disabled.projects.projects) setProjectBindings(project, [])
  await saveProjectSkills(root, saved, disabled)
  const reactivated = structuredClone(disabled)
  for (const project of reactivated.projects.projects) setSharedSkillPublication(project, skillId, true)
  await saveProjectSkills(root, disabled, reactivated)
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
  expect(await fs.readFile(library, 'utf8')).toBe(content)
})

test('a manual merge must be reviewed again and preserves every divergent version in recovery', async () => {
  await fs.appendFile(library, '\nLibrary-only requirement')
  await fs.appendFile(copilot, '\nCopilot-only requirement')
  await fs.appendFile(antigravity, '\nAntigravity-only requirement')
  const [stale] = await detectExternalChanges(root, data)
  const merged = '# Manual merge\n\nLibrary-only requirement\nCopilot-only requirement\nAntigravity-only requirement\n'
  await fs.writeFile(library, merged)
  await expect(resolveExternalChange(root, stale, library)).rejects.toThrow('mudaram apos')
  const [reviewed] = await detectExternalChanges(root, await readVault(root))
  const recovery = await resolveExternalChange(root, reviewed, library)
  const manifest: Array<{ path: string; snapshot: string }> = JSON.parse(await fs.readFile(join(recovery, 'manifest.json'), 'utf8'))
  for (const [file, requirement] of [[copilot, 'Copilot-only requirement'], [antigravity, 'Antigravity-only requirement']]) {
    const snapshot = manifest.find(entry => entry.path === file)!
    expect(await fs.readFile(join(recovery, snapshot.snapshot), 'utf8')).toContain(requirement)
  }
  expect(await fs.readFile(library, 'utf8')).toBe(merged)
  expect(await fs.readFile(copilot)).toEqual(await fs.readFile(antigravity))
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})

test.each(['library', 'copilot', 'antigravity'])('invalid YAML in selected $0 leaves all versions unchanged', async source => {
  const path = { library, copilot, antigravity }[source as 'library' | 'copilot' | 'antigravity']
  await fs.writeFile(path, '---\nname: [broken\n---\n# Invalid')
  const [change] = await detectExternalChanges(root, data)
  const before = await Promise.all([library, copilot, antigravity].map(file => fs.readFile(file)))
  await expect(resolveExternalChange(root, change, path)).rejects.toThrow('YAML invalido')
  expect(await Promise.all([library, copilot, antigravity].map(file => fs.readFile(file)))).toEqual(before)
  expect(await readVault(root)).toEqual(data)
})

test.each(['library', 'copilot', 'antigravity'])('files larger than 2 MB are explicitly rejected: %s', async source => {
  const path = { library, copilot, antigravity }[source as 'library' | 'copilot' | 'antigravity']
  await fs.writeFile(path, 'x'.repeat(2 * 1024 * 1024 + 1))
  const original = await readVault(root)
  await expect(detectExternalChanges(root, original)).rejects.toThrow('maior que 2 MB')
  expect(await readVault(root)).toEqual(original)
  expect((await fs.stat(path)).size).toBe(2 * 1024 * 1024 + 1)
})

test('frontmatter overhead exceeding 2 MB aborts synchronization before any writes', async () => {
  const content = 'x'.repeat(2 * 1024 * 1024)
  await fs.writeFile(library, content)
  const [change] = await detectExternalChanges(root, data)
  const original = await fs.readFile(copilot)
  await expect(resolveExternalChange(root, change, library)).rejects.toThrow('excede o limite de 2 MB')
  expect(await fs.readFile(library, 'utf8')).toBe(content)
  expect(await fs.readFile(copilot)).toEqual(original)
  expect(await fs.readFile(antigravity)).toEqual(original)
})

test('a publication exactly at the 2 MB limit synchronizes successfully', async () => {
  const overhead = skillPublicationMarkdown(data.catalog.skills[0], 'testes-unitarios-com-vitest', '').length
  await fs.writeFile(library, 'x'.repeat(2 * 1024 * 1024 - overhead))
  const [change] = await detectExternalChanges(root, data)
  await resolveExternalChange(root, change, library)
  expect((await fs.stat(copilot)).size).toBe(2 * 1024 * 1024)
  expect((await fs.readFile(copilot)).equals(await fs.readFile(antigravity))).toBe(true)
  expect(await detectExternalChanges(root, await readVault(root))).toEqual([])
})
