import { promises as fs } from 'node:fs'
import { beforeEach, afterEach, test, expect } from '@jest/globals'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createVault, readVault, readContained, saveVaultData, writeSkillFile } from '../src/vault'
import { emptyVault, validateVault } from '../src/model'
import { initializeSql, migrateDesktop, rebuildIndex } from '../src/database'

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

test('saves edited Markdown and metadata while preserving vault validation', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const data = await readVault(root)
  data.catalog.skills.push({
    id: 'skill-one', name: 'Skill one', category: 'Geral', description: 'Before',
    filePath: 'skills/skill-one.md', agents: [], status: 'pending', tags: ['old']
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
    id: 'test', name: 'Test', category: 'Geral', description: '', filePath: 'skills/test.md',
    agents: [], status: 'pending', tags: []
  })
  const root = join(temporary, 'vault')
  await expect(createVault(root, data)).rejects.toThrow('Conteudo ausente')
  await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects traversal, duplicate IDs and blocked project assignments', () => {
  const data = emptyVault()
  const skill = {
    id: 'test', name: 'Test', category: 'Geral', description: '', filePath: 'skills/test.md',
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

test('rejects metadata symlinks escaping the vault', async () => {
  const root = join(temporary, 'vault')
  await createVault(root)
  const outside = join(temporary, 'outside.md')
  await fs.writeFile(outside, '# Outside')
  await fs.symlink(outside, join(root, 'skills/outside.md'))
  await expect(readContained(root, join(root, 'skills/outside.md'))).rejects.toThrow('fora do cofre')
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
    'one', 'Architecture', 'Custom', 'Description', markdown, '["GitHub Copilot"]', 'validated', '["ts"]', '# Old snapshot'
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
    id: 'one', status: 'validated', tags: ['ts'], agents: ['GitHub Copilot'], originPath: markdown
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
