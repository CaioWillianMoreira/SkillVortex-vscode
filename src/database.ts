import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { emptyVault, uniqueSkillFilePath, validateVault, hasErrorCode, type VaultData } from './model'
import { z } from 'zod'

export function initializeSql(wasm: string): Promise<SqlJsStatic> {
  return initSqlJs({ locateFile: () => wasm })
}

const rowSchema = z.object({
  id: z.string(), name: z.string(), category: z.string(), description: z.string(),
  file_path: z.string(), agents_json: z.string(), status: z.enum(['validated', 'pending', 'allowed', 'blocked']),
  tags_json: z.string(), content: z.string().nullable()
})
const strings = z.array(z.string())

export async function migrateDesktop(SQL: SqlJsStatic, databasePath: string): Promise<{
  data: VaultData; contents: Map<string, string>; warnings: string[]
}> {
  try {
    const wal = await fs.stat(`${databasePath}-wal`)
    if (wal.size > 0) throw new Error('Feche o desktop e use um banco com WAL consolidado antes de importar.')
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  const buffer = await fs.readFile(databasePath)
  if (buffer.length > 128 * 1024 * 1024) throw new Error('Banco maior que 128 MB.')
  const db = new SQL.Database(buffer)
  try {
    const query = (sql: string) => {
      const statement = db.prepare(sql)
      const rows: Record<string, unknown>[] = []
      try {
        while (statement.step()) rows.push(statement.getAsObject())
      } finally { statement.free() }
      return rows
    }
    const tables = new Set(query("SELECT name FROM sqlite_master WHERE type = 'table'").map(r => r.name))
    for (const table of ['skills', 'projects', 'project_skills', 'settings']) {
      if (!tables.has(table)) throw new Error(`Banco desktop invalido: tabela ${table} ausente.`)
    }
    const data = emptyVault()
    const contents = new Map<string, string>()
    const warnings: string[] = []
    data.catalog.categories = tables.has('categories')
      ? query('SELECT name FROM categories').map(r => z.string().parse(r.name)) : []
    for (const raw of query('SELECT * FROM skills')) {
      const row = rowSchema.parse(raw)
      let content: string
      const original = row.file_path.startsWith('~/')
        ? join(homedir(), row.file_path.slice(2)) : row.file_path
      try {
        if (!isAbsolute(original)) throw new Error(`Caminho relativo nao pode ser resolvido: ${original}`)
        const stat = await fs.stat(original)
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error(`Markdown invalido: ${original}`)
        content = await fs.readFile(original, 'utf8')
      } catch (error) {
        if (hasErrorCode(error, 'ENOENT') && row.content !== null) {
          content = row.content
          warnings.push(`${row.name}: arquivo ausente; recuperado o conteudo salvo no banco.`)
        } else throw error
      }
      if (Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error(`Skill maior que 2 MB: ${row.name}`)
      data.catalog.skills.push({
        id: row.id, name: row.name, category: row.category,
        description: row.description.trim() || `Instrucoes para ${row.name.slice(0, 100)}.`,
        filePath: uniqueSkillFilePath(row.name, data.catalog.skills.map(skill => skill.filePath)),
        originPath: row.file_path,
        agents: strings.parse(JSON.parse(row.agents_json)), status: row.status === 'blocked' ? 'blocked' : 'allowed',
        tags: strings.parse(JSON.parse(row.tags_json))
      })
      if (!data.catalog.categories.includes(row.category)) data.catalog.categories.push(row.category)
      contents.set(row.id, content)
    }
    const paths = tables.has('project_paths') ? query('SELECT * FROM project_paths') : []
    const links = query('SELECT * FROM project_skills')
    for (const row of query('SELECT name FROM projects')) {
      const name = z.string().parse(row.name)
      const source = paths.find(p => p.project_name === name)?.root_path
      data.projects.projects.push({
        id: randomUUID(), name, sourcePath: source === undefined ? undefined : z.string().parse(source),
        skillIds: links.filter(l => l.project_name === name).map(l => z.string().parse(l.skill_id))
      })
    }
    const active = query("SELECT value FROM settings WHERE key = 'activeProject'")[0]?.value
    data.projects.activeProject = data.projects.projects.find(p => p.name === active)?.id ?? null
    return { data: validateVault(data.catalog, data.projects), contents, warnings }
  } finally { db.close() }
}

export async function rebuildIndex(SQL: SqlJsStatic, storage: string, root: string, data: VaultData): Promise<void> {
  const db = new SQL.Database()
  try {
    db.run('CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, metadata TEXT NOT NULL)')
    db.run('CREATE TABLE projects (id TEXT PRIMARY KEY, metadata TEXT NOT NULL)')
    db.run('BEGIN')
    for (const skill of data.catalog.skills) {
      db.run('INSERT INTO skills VALUES (?, ?, ?, ?, ?)', [skill.id, skill.name, skill.category, skill.status, JSON.stringify(skill)])
    }
    for (const project of data.projects.projects) db.run('INSERT INTO projects VALUES (?, ?)', [project.id, JSON.stringify(project)])
    db.run('COMMIT')
    await fs.mkdir(storage, { recursive: true })
    const destination = join(storage, `${createHash('sha256').update(root).digest('hex')}.sqlite`)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, db.export())
      await fs.rename(temporary, destination)
    } finally { await fs.rm(temporary, { force: true }) }
  } finally { db.close() }
}
