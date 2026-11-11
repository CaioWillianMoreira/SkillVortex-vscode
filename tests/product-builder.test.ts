import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createVault } from '../src/vault'
import { createMindCardsExamples, readMindNote, saveMindFolder, saveMindNote, setMindNoteArchived } from '../src/mindcards'
import { readBuilderSources } from '../src/product-builder'
import { buildFaithfulSkill, builderMarkdown, builderMessages, builderRequestSchema } from '../src/product-builder-model'

let temporary: string
let root: string
const folderId = randomUUID()
beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'product-builder-'))
  root = join(temporary, 'vault')
  await createVault(root)
  await saveMindFolder(root, { id: folderId, name: 'Negocio', color: '#1677ff' }, null)
})
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })
const input = (title: string, content = 'Desconto maximo de 10%.') => ({ title, content, folderId, tags: [], links: [] })

test('reads only explicitly selected notes without automatically including linked cards', async () => {
  const other = await saveMindNote(root, input('Outra regra'))
  const selected = await saveMindNote(root, { ...input('Desconto'), links: [other.note.id] })
  const sources = await readBuilderSources(root, { objective: 'Orientar checkout', notes: [{ id: selected.note.id, revision: selected.note.revision }] })
  expect(sources).toEqual([{ id: selected.note.id, title: 'Desconto', content: 'Desconto maximo de 10%.' }])
  const messages = builderMessages('Orientar checkout', sources)
  expect(messages[0].content).toContain('Nao invente requisitos')
  expect(messages[1].content).toContain('Objetivo: Orientar checkout')
  expect(messages[1].content).toContain('Desconto:\nDesconto maximo de 10%.')
  expect(messages[0].content).toContain('Do not write a skill or rewrite its rules')
  expect(messages[1].content).toContain('## Passos sugeridos')
})

test('builds the skill without AI, retaining complete source text, objective, numbers and exceptions', () => {
  const sources = [
    { id: randomUUID(), title: 'SEO', content: '### Contexto\r\n\r\nSEO para paginas publicas.\r\n- Usar title.\r\n- Nao indexar dados privados.\r\n' },
    { id: randomUUID(), title: 'Desconto', content: '# Regra\n\nLimite: 10%, exceto clientes VIP.\n\n```json\n{"limite":10}\n```' }
  ]
  const objective = 'Implementar SEO sem alterar descontos.'
  const result = buildFaithfulSkill('Minha skill', objective, sources)
  expect(result.startsWith('# Minha skill\n')).toBe(true)
  expect(result).toContain(`## Objetivo\n\n${objective}`)
  for (const source of sources) expect(result).toContain(source.content)
  for (const heading of ['Quando usar', 'Regras e contexto originais', 'Passos', 'Validacao']) expect(result).toContain(`## ${heading}`)
  expect(result).not.toContain('Passos sugeridos')
  expect(result).toBe(buildFaithfulSkill('Minha skill', objective, sources))
})

test('preserves the full real SEO example instead of generating an explanation of Contexto', async () => {
  const exampleRoot = join(temporary, 'examples')
  await createVault(exampleRoot)
  const examples = await createMindCardsExamples(exampleRoot)
  const seo = examples.notes.find(note => note.tags.includes('seo'))!
  const request = { objective: 'Implementar SEO nas paginas publicas', notes: [{ id: seo.id, revision: seo.revision }] }
  const sources = await readBuilderSources(exampleRoot, request)
  const result = buildFaithfulSkill('SEO do site', request.objective, sources)
  expect(result).toContain(sources[0].content)
  for (const term of ['robots.txt', 'URL canonica', 'Search Console', 'title', 'meta description']) expect(result).toContain(term)
  expect(result).not.toContain('O contexto e um termo')
})

test('accepts Markdown text and removes only a wrapping Markdown code fence', () => {
  const markdown = '# Desconto\n\n## Regras\n- Limite de 10%.'
  expect(builderMarkdown(markdown)).toBe(markdown)
  expect(builderMarkdown(`\`\`\`markdown\n${markdown}\n\`\`\``)).toBe(markdown)
  expect(builderMarkdown(`\`\`\`md\r\n${markdown}\r\n\`\`\``)).toBe(markdown)
  expect(builderMarkdown('# Exemplo\n\n```json\n{"limite":10}\n```')).toContain('```json')
})

test('rejects JSON documents, JSON fences and empty or unstructured responses explicitly', () => {
  for (const text of ['{"content":"# Desconto"}', '[{"regra":"10%"}]', '```json\n{"regra":"10%"}\n```', '', 'Aqui esta a skill:']) {
    expect(() => builderMarkdown(text)).toThrow('Markdown (.md)')
  }
})
test('rejects missing selection, duplicate cards, excess cards and blank objectives', () => {
  expect(builderRequestSchema.safeParse({ objective: '', notes: [] }).success).toBe(false)
  const note = { id: randomUUID(), revision: 'hash' }
  expect(builderRequestSchema.safeParse({ objective: 'Objetivo', notes: [note, note] }).success).toBe(false)
  expect(builderRequestSchema.safeParse({ objective: 'Objetivo', notes: Array.from({ length: 9 }, () => ({ ...note, id: randomUUID() })) }).success).toBe(false)
})

test('rejects changed, archived and excessive source content without truncating silently', async () => {
  const note = await saveMindNote(root, input('Regra'))
  const request = { objective: 'Objetivo', notes: [{ id: note.note.id, revision: note.note.revision }] }
  await expect(readBuilderSources(root, { ...request, notes: [{ id: note.note.id, revision: 'stale' }] })).rejects.toThrow('mudou')
  await setMindNoteArchived(root, note.note.id, note.note.revision, true)
  await expect(readBuilderSources(root, request)).rejects.toThrow('mudou')
  const archived = await readMindNote(root, note.note.id)
  await expect(readBuilderSources(root, { ...request, notes: [{ id: note.note.id, revision: archived.note.revision }] })).rejects.toThrow('arquivada')
  const large = await saveMindNote(root, input('Grande', 'a'.repeat(12000)))
  await expect(readBuilderSources(root, { ...request, notes: [{ id: large.note.id, revision: large.note.revision }] })).rejects.toThrow('12.000')
})
