import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { createVault, readVault } from '../src/vault'
import {
  createMindCardsExamples, deleteMindFolder, deleteMindNote, mindCardsSnapshot, readMindCards, readMindNote,
  restoreMindCardsSnapshot, saveMindFolder, saveMindNote
} from '../src/mindcards'
import { createVaultBackup, restoreVaultBackup } from '../src/backup'
import type { MindFolder } from '../src/mindcards-model'

let temporary: string
let root: string
const folder: MindFolder = { id: randomUUID(), name: 'Agendamentos', color: '#52c41a' }
beforeEach(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'mindcards-test-'))
  root = join(temporary, 'vault')
  await createVault(root)
})
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }) })
const initialize = () => saveMindFolder(root, folder, null)
const input = (title = 'Cancelar agendamento') => ({
  title, folderId: folder.id, tags: ['regra'], links: [], content: '# Regra\n\nCancelar ate duas horas antes.\n'
})

test('existing vaults open without creating MindCards data or altering skills', async () => {
  const before = await readVault(root)
  expect(await readMindCards(root)).toEqual({ folders: [], notes: [], revision: null })
  expect(await fs.readdir(root)).toEqual(expect.not.arrayContaining(['mindcards']))
  expect(await readVault(root)).toEqual(before)
})

test('examples create exactly four technology and squad cards with valid connections without modifying skills', async () => {
  const before = await readVault(root)
  const state = await createMindCardsExamples(root)
  expect(state.folders.map(item => item.name)).toEqual(['Frontend', 'Backend', 'Qualidade', 'Squad'])
  expect(new Set(state.folders.map(item => item.color)).size).toBe(4)
  expect(state.notes).toHaveLength(4)
  for (const folder of state.folders) {
    expect(state.notes.filter(note => note.folderId === folder.id)).toHaveLength(1)
  }
  for (const note of state.notes) {
    expect(note.links).toHaveLength(3)
    expect(note.links.every(id => id !== note.id && state.notes.some(item => item.id === id))).toBe(true)
    const document = await readMindNote(root, note.id)
    expect(document.content).toContain('## Contexto')
    expect(document.content.length).toBeGreaterThan(300)
  }
  const note = state.notes[0]
  const document = await readMindNote(root, note.id)
  await saveMindNote(root, { ...note, content: document.content + '\nAcordo do meu squad.' }, note.id, note.revision)
  expect((await readMindNote(root, note.id)).content).toContain('Acordo do meu squad.')
  expect(await readVault(root)).toEqual(before)
  const snapshot = await mindCardsSnapshot(root)
  await expect(createMindCardsExamples(root)).rejects.toThrow('MindCards vazio')
  expect(await mindCardsSnapshot(root)).toEqual(snapshot)
})

test('examples do not replace even an empty folder configured by the user', async () => {
  await initialize()
  await expect(createMindCardsExamples(root)).rejects.toThrow('MindCards vazio')
  expect((await readMindCards(root)).folders).toEqual([folder])
})

test('folders and Markdown notes persist after reopening and copying the vault', async () => {
  await initialize()
  const before = await readVault(root)
  const saved = await saveMindNote(root, input())
  expect(saved.note.filePath).toBe('mindcards/cancelar-agendamento.md')
  expect(saved.content).toBe(input().content)
  expect((await readMindCards(root)).folders).toEqual([folder])
  const raw = await fs.readFile(join(root, saved.note.filePath), 'utf8')
  expect(raw).toMatch(/^---\n/)
  expect(raw).toContain('# Regra')
  const copied = join(temporary, 'copy')
  await fs.cp(root, copied, { recursive: true })
  expect(await readMindNote(copied, saved.note.id)).toEqual(saved)
  expect(await readVault(root)).toEqual(before)
})

test('folder names and same-folder note titles are unique after normalization', async () => {
  const state = await initialize()
  await expect(saveMindFolder(root, { ...folder, id: randomUUID(), name: ' AGENDAMENTOS ' }, state.revision)).rejects.toThrow('Ja existe')
  await saveMindNote(root, input())
  await expect(saveMindNote(root, input(' cancelar AGENDAMENTO '))).rejects.toThrow('Ja existe')
})

test('notes with equal titles in different folders use distinct readable filenames', async () => {
  const first = await initialize()
  const second = { ...folder, id: randomUUID(), name: 'Financeiro' }
  await saveMindFolder(root, second, first.revision)
  const one = await saveMindNote(root, input())
  const two = await saveMindNote(root, { ...input(), folderId: second.id })
  expect(one.note.filePath).not.toBe(two.note.filePath)
  expect(two.note.filePath).toBe('mindcards/cancelar-agendamento-2.md')
})

test('links persist, expose backlinks and protect referenced notes against deletion', async () => {
  await initialize()
  const one = await saveMindNote(root, input())
  const two = await saveMindNote(root, { ...input('Limite de cancelamento'), links: [one.note.id] })
  const state = await readMindCards(root)
  expect(state.notes.filter(note => note.links.includes(one.note.id)).map(note => note.id)).toEqual([two.note.id])
  await expect(deleteMindNote(root, one.note.id, one.note.revision)).rejects.toThrow('Remova primeiro')
  const updated = await saveMindNote(root, input('Limite de cancelamento'), two.note.id, two.note.revision)
  expect(updated.note.links).toEqual([])
  await deleteMindNote(root, one.note.id, one.note.revision)
  expect((await readMindCards(root)).notes).toHaveLength(1)
})

test('stale notes cannot overwrite or delete externally edited Markdown', async () => {
  await initialize()
  const one = await saveMindNote(root, input())
  await fs.appendFile(join(root, one.note.filePath), '\nEdicao externa')
  await expect(saveMindNote(root, input(), one.note.id, one.note.revision)).rejects.toThrow('alterado fora')
  await expect(deleteMindNote(root, one.note.id, one.note.revision)).rejects.toThrow('alterado fora')
  expect((await readMindNote(root, one.note.id)).content).toContain('Edicao externa')
})

test('folder writes reject stale revisions and preserve external metadata', async () => {
  const state = await initialize()
  await saveMindFolder(root, { ...folder, name: 'Novo nome', color: '#1677ff' }, state.revision)
  await expect(saveMindFolder(root, folder, state.revision)).rejects.toThrow('alterado fora')
  expect((await readMindCards(root)).folders[0].name).toBe('Novo nome')
})

test('moving a note preserves its ID, file and links; only empty folders can be deleted', async () => {
  const state = await initialize()
  const second = { ...folder, id: randomUUID(), name: 'Outras' }
  const folders = await saveMindFolder(root, second, state.revision)
  const one = await saveMindNote(root, input())
  await expect(deleteMindFolder(root, folder.id, folders.revision)).rejects.toThrow('Mova ou exclua')
  const moved = await saveMindNote(root, { ...input(), folderId: second.id }, one.note.id, one.note.revision)
  expect(moved.note.id).toBe(one.note.id)
  expect(moved.note.filePath).toBe(one.note.filePath)
  await deleteMindFolder(root, folder.id, folders.revision)
  expect((await readMindCards(root)).folders).toEqual([second])
})

test('invalid folders, links and oversized content are rejected explicitly', async () => {
  await initialize()
  await expect(saveMindNote(root, { ...input(), folderId: randomUUID() })).rejects.toThrow('pasta existente')
  await expect(saveMindNote(root, { ...input(), links: [randomUUID()] })).rejects.toThrow('notas existentes')
  await expect(saveMindNote(root, { ...input(), content: 'a'.repeat(2 * 1024 * 1024) })).rejects.toThrow('2 MB')
  expect((await readMindCards(root)).notes).toHaveLength(0)
})

test('invalid YAML is reported without replacing the note', async () => {
  await initialize()
  const one = await saveMindNote(root, input())
  const invalid = '---\ntitle: [\n---\nNao sobrescrever'
  await fs.writeFile(join(root, one.note.filePath), invalid)
  await expect(readMindCards(root)).rejects.toThrow('YAML invalido')
  expect(await fs.readFile(join(root, one.note.filePath), 'utf8')).toBe(invalid)
})

test('MindCards rejects symlink directories and symlink notes', async () => {
  const outside = join(temporary, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, join(root, 'mindcards'))
  await expect(initialize()).rejects.toThrow('sem link simbolico')
  await fs.unlink(join(root, 'mindcards'))
  await initialize()
  await fs.writeFile(join(outside, 'note.md'), 'External')
  await fs.symlink(join(outside, 'note.md'), join(root, 'mindcards', 'note.md'))
  await expect(readMindCards(root)).rejects.toThrow('Arquivo inesperado')
})

test('backup restores notes, folder colors and connections and preserves recovery point', async () => {
  await initialize()
  const one = await saveMindNote(root, input())
  await saveMindNote(root, { ...input('Relacionada'), links: [one.note.id] })
  const original = await mindCardsSnapshot(root)
  const backup = await createVaultBackup(root)
  await saveMindNote(root, { ...input(), content: 'Alterado' }, one.note.id, one.note.revision)
  const changed = await mindCardsSnapshot(root)
  const restored = await restoreVaultBackup(root, backup.id)
  expect(await mindCardsSnapshot(root)).toEqual(original)
  await restoreVaultBackup(root, restored.recoveryPoint.id)
  expect(await mindCardsSnapshot(root)).toEqual(changed)
})

test('legacy backups preserve MindCards while new empty snapshots restore an empty area', async () => {
  const backup = await createVaultBackup(root)
  const manifestPath = join(root, '.skillvortex/backups', backup.id, 'backup.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  await fs.writeFile(manifestPath, JSON.stringify({ version: 1, createdAt: manifest.createdAt }))
  await initialize()
  await saveMindNote(root, input())
  await restoreVaultBackup(root, backup.id)
  expect((await readMindCards(root)).notes).toHaveLength(1)
  await fs.writeFile(manifestPath, JSON.stringify(manifest))
  await restoreVaultBackup(root, backup.id)
  expect((await readMindCards(root)).notes).toHaveLength(0)
})

test('failed metadata restore rolls MindCards back to its previous content', async () => {
  await initialize()
  const one = await saveMindNote(root, input())
  const backup = await createVaultBackup(root)
  await saveMindNote(root, { ...input(), content: 'Preservar atual' }, one.note.id, one.note.revision)
  const current = await mindCardsSnapshot(root)
  // Change project metadata so the existing restore verifier can distinguish an uncommitted write.
  const projects = join(root, '.skillvortex/projetos.json')
  const parsed = JSON.parse(await fs.readFile(projects, 'utf8'))
  parsed.projects = [{ id: 'later', name: 'Later', skillIds: [] }]
  await fs.writeFile(projects, JSON.stringify(parsed))
  await expect(restoreVaultBackup(root, backup.id, async () => { throw new Error('Simulated write failure') })).rejects.toThrow('Simulated')
  expect(await mindCardsSnapshot(root)).toEqual(current)
})

test('invalid snapshot paths cannot escape the module area', async () => {
  await expect(restoreMindCardsSnapshot(root, new Map([['../outside.md', 'text']]))).rejects.toThrow()
  await expect(fs.stat(join(root, 'outside.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})
