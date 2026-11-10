import { promises as fs } from 'node:fs'
import { beforeEach, afterEach, test, expect } from '@jest/globals'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createVault, readVault, readContained, saveVaultData, writeSkillFile } from '../src/vault'
import { emptyVault, validateVault, selectedSkillIds, setCollectionLinked, isCollectionLinked } from '../src/model'
import { initializeSql, migrateDesktop, rebuildIndex } from '../src/database'
import { createVaultBackup, listVaultBackups, restoreVaultBackup } from '../src/backup'
import { SKILL_CARD_COLORS } from '../src/skill-colors'

let temporary: string
beforeEach(async () => { temporary = await fs.mkdtemp(join(tmpdir(), 'skillvortex-extension-')) })
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })
const sql = () => initializeSql(require.resolve('sql.js/dist/sql-wasm.wasm'))

test('creates and reloads portable metadata with backup directory', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  expect(await readVault(root)).toEqual(emptyVault())
  expect((await fs.stat(join(root, '.skillvortex/backups'))).isDirectory()).toBe(true)
})

test('never overwrites an existing destination', async () => {
  const root = join(temporary, 'vault')
  await fs.mkdir(root)
  await fs.writeFile(join(root, 'keep.txt'), 'original')
  await expect(createVault(root)).rejects.toThrow('Nada foi sobrescrito')
  expect(await fs.readFile(join(root, 'keep.txt'), 'utf8')).toBe('original')
})

test('backup restores checkbox choices and a card active with no selected skills', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  data.catalog.skills.push({ id: 'one', name: 'One skill', category: 'Geral', description: 'QA',
    filePath: 'skills/one.md', agents: ['GitHub Copilot'], tags: [], status: 'allowed' })
  data.catalog.collections = [{ id: 'card', name: 'Card', skillIds: ['one'], disabledSkillIds: ['one'] }]
  data.projects.projects = [{ id: 'project', name: 'Project', skillIds: [] }]
  setCollectionLinked(data.projects.projects[0], 'card', 'GitHub Copilot', true)
  await writeSkillFile(root, 'skills/one.md', '# One')
  await saveVaultData(root, data)
  const backup = await createVaultBackup(root)
  data.catalog.collections[0].disabledSkillIds = []
  setCollectionLinked(data.projects.projects[0], 'card', 'GitHub Copilot', false)
  await saveVaultData(root, data)
  await restoreVaultBackup(root, backup.id)
  const restored = await readVault(root)
  expect(selectedSkillIds(restored.catalog.collections![0])).toEqual([])
  expect(isCollectionLinked(restored.projects.projects[0], restored.catalog.collections![0], 'GitHub Copilot')).toBe(true)
})

test.each(['pending', 'validated', 'allowed', 'blocked'])('legacy status %s migrates without changing Markdown', async status => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  const skill = { id: 'legacy', name: 'Legacy', category: 'Geral', description: 'QA',
    filePath: 'skills/legacy.md', agents: [], status, tags: [] }
  const catalog = { ...data.catalog, skills: [skill],
    collections: [{ id: 'card', name: 'Legacy card', skillIds: ['legacy'], status }] }
  await writeSkillFile(root, skill.filePath, '# Original')
  await fs.writeFile(join(root, '.skillvortex/catalogo.json'), JSON.stringify(catalog))
  const loaded = await readVault(root)
  const expected = status === 'blocked' ? 'blocked' : 'allowed'
  expect(loaded.catalog.skills[0].status).toBe(expected)
  expect(loaded.catalog.collections![0].status).toBe(expected)
  await saveVaultData(root, loaded)
  expect(JSON.parse(await fs.readFile(join(root, '.skillvortex/catalogo.json'), 'utf8')).skills[0].status).toBe(expected)
  expect(await fs.readFile(join(root, skill.filePath), 'utf8')).toBe('# Original')
})

test('persisting a skill in two cards is rejected without changing library files', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  data.catalog.skills.push({ id: 'exclusive', name: 'Exclusive', category: 'Geral', description: 'QA',
    filePath: 'skills/exclusive.md', agents: [], status: 'allowed', tags: [] })
  data.catalog.collections = [
    { id: 'one', name: 'One', skillIds: ['exclusive'] },
    { id: 'two', name: 'Two', skillIds: ['exclusive'] }
  ]
  await expect(saveVaultData(root, data)).rejects.toThrow('apenas um card')
  expect((await readVault(root)).catalog.skills).toEqual([])
})

test.each(['skills', 'cards', 'cross-kind'])('catalog persistence rejects global duplicate titles: %s', async kind => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  const skill = { id: 'first', name: 'Revisão', category: 'Geral', description: 'QA',
    filePath: 'skills/first.md', agents: [], status: 'allowed' as const, tags: [] }
  if (kind !== 'cards') data.catalog.skills.push(skill)
  if (kind === 'skills') data.catalog.skills.push({ ...skill, id: 'second', filePath: 'skills/second.md', name: ' REVISA\u0303O ' })
  else data.catalog.collections = kind === 'cards'
    ? [{ id: 'first', name: 'Revisão', skillIds: [] }, { id: 'second', name: ' REVISA\u0303O ', skillIds: [] }]
    : [{ id: 'second', name: ' REVISA\u0303O ', skillIds: [] }]
  const original = await readVault(root)
  await expect(saveVaultData(root, data)).rejects.toThrow('Use um titulo unico')
  expect(await readVault(root)).toEqual(original)
})

test('saves edited Markdown and metadata while preserving vault validation', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  data.catalog.skills.push({
    id: 'skill-one', name: 'Skill one', category: 'Geral', description: 'Before',
    filePath: 'skills/skill-one.md', agents: [], status: 'allowed', tags: ['old']
  })

  await writeSkillFile(root, 'skills/skill-one.md', '# Before')
  await saveVaultData(root, data)

  data.catalog.skills[0].name = 'Updated skill'
  data.catalog.skills[0].description = 'After'
  data.catalog.skills[0].tags = ['updated']
  data.projects.projects.push({ id: 'project-one', name: 'Project', skillIds: ['skill-one'] })
  data.projects.activeProject = 'project-one'
  await writeSkillFile(root, 'skills/skill-one.md', '# After')
  await saveVaultData(root, data)

  expect(await readVault(root)).toEqual(data)
  expect(await readContained(root, join(root, 'skills/skill-one.md'))).toBe('# After')
  await expect(writeSkillFile(root, '../outside.md', 'unsafe')).rejects.toThrow('Caminho de skill invalido')
})

test('creates a complete backup and restores it with an automatic recovery point', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const original = await readVault(root)
  original.catalog.skills.push({
    id: 'skill-one', name: 'Original skill', category: 'Geral', description: 'Original',
    filePath: 'skills/skill-one.md', agents: [], status: 'allowed', tags: [],
    cardColor: SKILL_CARD_COLORS[6]
  })
  original.projects.projects.push({ id: 'project-one', name: 'Original project', skillIds: ['skill-one'] })
  original.projects.activeProject = 'project-one'
  await writeSkillFile(root, 'skills/skill-one.md', '# Original content')
  await saveVaultData(root, original)
  const backup = await createVaultBackup(root)

  const changed = await readVault(root)
  changed.catalog.skills[0].name = 'Changed skill'
  changed.catalog.skills[0].cardColor = SKILL_CARD_COLORS[7]
  changed.projects.projects[0].name = 'Changed project'
  await writeSkillFile(root, 'skills/skill-one.md', '# Changed content')
  await saveVaultData(root, changed)

  const result = await restoreVaultBackup(root, backup.id)
  expect(result.restored.id).toBe(backup.id)
  expect(result.recoveryPoint.id).not.toBe(backup.id)
  expect(await readVault(root)).toEqual(original)
  expect(await readContained(root, join(root, 'skills/skill-one.md'))).toBe('# Original content')
  const listed = await listVaultBackups(root)
  expect(listed.map(item => item.id)).toContain(backup.id)
  expect(listed.map(item => item.id)).toContain(result.recoveryPoint.id)
})

test('rejects a corrupt backup without changing the current vault', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const backup = await createVaultBackup(root)
  await fs.writeFile(join(root, '.skillvortex/backups', backup.id, '.skillvortex/catalogo.json'), '{')
  const original = await readVault(root)
  await expect(listVaultBackups(root)).rejects.toThrow('Backup invalido')
  await expect(restoreVaultBackup(root, backup.id)).rejects.toThrow()
  expect(await readVault(root)).toEqual(original)
})

test('refuses backup directories that escape the vault through a symlink', async () => {
  const root = join(temporary, 'vault')
  const outside = join(temporary, 'outside')
  await createVault(root)
  await fs.mkdir(outside)
  await fs.rm(join(root, '.skillvortex/backups'), { recursive: true, force: true })
  await fs.symlink(outside, join(root, '.skillvortex/backups'), 'dir')
  await expect(createVaultBackup(root)).rejects.toThrow('fora da biblioteca')
  await expect(listVaultBackups(root)).rejects.toThrow('fora da biblioteca')
  expect(await fs.readdir(outside)).toEqual([])
})

test('restores original metadata when a multi-file save cannot be published', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const original = await fs.readFile(join(root, '.skillvortex/catalogo.json'), 'utf8')
  await fs.unlink(join(root, '.skillvortex/projetos.json'))
  const data = await readVault(root).catch(() => emptyVault())
  await expect(saveVaultData(root, data)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await fs.readFile(join(root, '.skillvortex/catalogo.json'), 'utf8')).toBe(original)
  expect((await fs.readdir(join(root, '.skillvortex'))).sort()).toEqual(['backups', 'catalogo.json'])
})

test('failed import cleans only its newly created destination', async () => {
  const data = emptyVault()
  data.catalog.skills.push({
    id: 'test', name: 'Test', category: 'Geral', description: 'Test description', filePath: 'skills/test.md',
    agents: [], status: 'allowed', tags: []
  })
  const root = join(temporary, 'vault')
  await expect(createVault(root, data)).rejects.toThrow('Conteudo ausente')
  await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects traversal, duplicate IDs and blocked project assignments', () => {
  const data = emptyVault()
  const skill = {
    id: 'test', name: 'Test', category: 'Geral', description: 'Test description', filePath: 'skills/test.md',
    agents: [], status: 'blocked' as const, tags: []
  }
  data.catalog.skills.push(skill)
  data.projects.projects.push({ id: 'p', name: 'Project', skillIds: ['test'] })
  expect(() => validateVault(data.catalog, data.projects)).toThrow('bloqueada')
  data.projects.projects = []
  data.catalog.skills.push(skill)
  expect(() => validateVault(data.catalog, data.projects)).toThrow()
  data.catalog.skills = [{ ...skill, filePath: '../outside.md' }]
  expect(() => validateVault(data.catalog, data.projects)).toThrow()
})

test('upgrades legacy empty skill descriptions to an explicit edit reminder', async () => {
  const data = emptyVault()
  data.catalog.skills.push({
    id: 'legacy', name: 'Legacy skill', category: 'Geral', description: '',
    filePath: 'skills/legacy-skill.md', agents: [], status: 'allowed', tags: []
  })

  expect(validateVault(data.catalog, data.projects).catalog.skills[0].description)
    .toBe('Skill importada sem descricao; edite este campo (Legacy skill).')
})

test('rejects metadata symlinks escaping the vault', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const outside = join(temporary, 'outside.md')
  await fs.writeFile(outside, '# Outside')
  await fs.symlink(outside, join(root, 'skills/outside.md'))
  await expect(readContained(root, join(root, 'skills/outside.md'))).rejects.toThrow('fora da biblioteca')
})

async function legacyFixture() {
  const SQL = await sql()
  const db = new SQL.Database()
  const markdown = join(temporary, 'original.md')
  await fs.writeFile(markdown, '# Latest on disk')
  db.run(`
    CREATE TABLE skills (id TEXT, name TEXT, category TEXT, description TEXT, file_path TEXT, agents_json TEXT, status TEXT, tags_json TEXT, content TEXT);
    CREATE TABLE projects (name TEXT);
    CREATE TABLE project_skills (project_name TEXT, skill_id TEXT);
    CREATE TABLE settings (key TEXT, value TEXT);
    CREATE TABLE categories (name TEXT);
    CREATE TABLE project_paths (project_name TEXT, root_path TEXT);
    INSERT INTO projects VALUES ('Project');
    INSERT INTO categories VALUES ('Custom');
    INSERT INTO project_skills VALUES ('Project', 'one');
    INSERT INTO settings VALUES ('activeProject', 'Project');
    INSERT INTO project_paths VALUES ('Project', '/old/project');
  `)
  db.run('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    'one', 'Architecture', 'Custom', 'Description', markdown, '["GitHub Copilot"]', 'allowed', '["ts"]', '# Old snapshot'
  ])
  const file = join(temporary, 'desktop.sqlite')
  await fs.writeFile(file, db.export())
  db.close()
  return { SQL, file, markdown }
}

test('migrates metadata, categories and assignments, using current disk content without changing originals', async () => {
  const { SQL, file, markdown } = await legacyFixture()
  const before = await fs.readFile(file)
  const result = await migrateDesktop(SQL, file)
  expect(result.data.catalog.skills[0]).toMatchObject({
    id: 'one', status: 'allowed', tags: ['ts'], agents: ['GitHub Copilot'], originPath: markdown
  })
  expect(result.data.projects.projects[0]).toMatchObject({ name: 'Project', sourcePath: '/old/project', skillIds: ['one'] })
  expect(result.data.projects.activeProject).toBe(result.data.projects.projects[0].id)
  const root = join(temporary, 'vault')
  await createVault(root, result.data, result.contents)
  expect(await fs.readFile(join(root, result.data.catalog.skills[0].filePath), 'utf8')).toBe('# Latest on disk')
  expect(await fs.readFile(file)).toEqual(before)
  expect(await fs.readFile(markdown, 'utf8')).toBe('# Latest on disk')
  const reloaded = await readVault(root)
  expect(reloaded).toEqual(result.data)
  await rebuildIndex(SQL, join(temporary, 'index'), root, reloaded)
  const index = (await fs.readdir(join(temporary, 'index')))[0]
  const db = new SQL.Database(await fs.readFile(join(temporary, 'index', index)))
  expect(db.exec('SELECT name FROM skills')[0].values).toEqual([['Architecture']])
  db.close()
})

test('uses stored content for missing Markdown only with explicit warning', async () => {
  const { SQL, file, markdown } = await legacyFixture()
  await fs.unlink(markdown)
  const result = await migrateDesktop(SQL, file)
  expect(result.contents.get('one')).toBe('# Old snapshot')
  expect(result.warnings).toHaveLength(1)
})

test('rejects missing Markdown without recoverable content', async () => {
  const { SQL, file, markdown } = await legacyFixture()
  const db = new SQL.Database(await fs.readFile(file))
  db.run('UPDATE skills SET content = NULL')
  await fs.writeFile(file, db.export())
  db.close()
  await fs.unlink(markdown)
  await expect(migrateDesktop(SQL, file)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects unconsolidated WAL and unrelated SQLite files', async () => {
  const { SQL, file } = await legacyFixture()
  await fs.writeFile(`${file}-wal`, 'pending writes')
  await expect(migrateDesktop(SQL, file)).rejects.toThrow('WAL')
  await fs.unlink(`${file}-wal`)
  const db = new SQL.Database()
  await fs.writeFile(file, db.export())
  db.close()
  await expect(migrateDesktop(SQL, file)).rejects.toThrow('tabela skills ausente')
})
