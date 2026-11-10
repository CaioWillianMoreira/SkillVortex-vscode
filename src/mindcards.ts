import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { z } from 'zod'
import { hasErrorCode, skillSlug, titleKey } from './model'
import { splitMarkdown } from './markdown-content'
import { readContained } from './vault'
import {
  mindFolderSchema, mindNoteInputSchema, mindNoteMetadataSchema,
  type MindCardsState, type MindFolder, type MindNoteDocument, type MindNoteInput
} from './mindcards-model'

const foldersSchema = z.object({ version: z.literal(1), folders: z.array(mindFolderSchema).max(1000) })
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const conflict = () => new Error('O MindCards foi alterado fora desta tela. Atualize e revise antes de salvar; seu rascunho foi preservado.')

async function directory(root: string, create = false): Promise<string> {
  const canonical = await fs.realpath(root)
  const path = join(canonical, 'mindcards')
  if (create) await fs.mkdir(path, { recursive: true })
  const stat = await fs.lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('A pasta MindCards deve ser um diretorio local, sem link simbolico.')
  return path
}

async function atomicWrite(path: string, content: string, createOnly = false): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' })
    if (createOnly) await fs.link(temporary, path)
    else await fs.rename(temporary, path)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

function parseNote(filePath: string, raw: string): MindNoteDocument {
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error(`Nota maior que 2 MB: ${filePath}`)
  const { metadata, body } = splitMarkdown(raw)
  if (!metadata) throw new Error(`Nota sem metadados MindCards: ${filePath}`)
  const document = parseDocument(metadata.replace(/^\uFEFF?---\r?\n/, '').replace(/\r?\n---(?:\r?\n)?$/, ''))
  if (document.errors.length) throw new Error(`YAML invalido em ${filePath}: ${document.errors[0].message}`)
  const value = mindNoteMetadataSchema.parse(document.toJSON())
  return { note: { ...value, filePath, revision: digest(raw) }, content: body }
}

export async function mindCardsSnapshot(root: string): Promise<Map<string, string> | null> {
  let path: string
  try { path = await directory(root) } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  const files = new Map<string, string>()
  for (const entry of await fs.readdir(path, { withFileTypes: true })) {
    if (entry.name.endsWith('.tmp')) continue
    if (!entry.isFile() || !/^(pastas\.json|[a-z0-9][a-z0-9-]*\.md)$/.test(entry.name)) {
      throw new Error(`Arquivo inesperado na pasta reservada MindCards: ${entry.name}`)
    }
    files.set(entry.name, await readContained(root, join(path, entry.name)))
  }
  validateSnapshot(files)
  return files
}

function validateSnapshot(files: Map<string, string>): MindCardsState {
  const rawFolders = files.get('pastas.json')
  const folders = rawFolders === undefined ? [] : foldersSchema.parse(JSON.parse(rawFolders)).folders
  if (new Set(folders.map(folder => folder.id)).size !== folders.length ||
    new Set(folders.map(folder => titleKey(folder.name))).size !== folders.length) {
    throw new Error('Pastas MindCards duplicadas.')
  }
  const notes = [...files].filter(([name]) => name.endsWith('.md')).map(([name, raw]) =>
    parseNote(`mindcards/${name}`, raw).note)
  if (new Set(notes.map(note => note.id)).size !== notes.length) throw new Error('IDs de notas duplicados.')
  for (const note of notes) {
    if (!folders.some(folder => folder.id === note.folderId)) throw new Error(`Pasta da nota nao encontrada: ${note.title}`)
  }
  return { folders, notes, revision: rawFolders === undefined ? null : digest(rawFolders) }
}

export async function readMindCards(root: string): Promise<MindCardsState> {
  return validateSnapshot(await mindCardsSnapshot(root) ?? new Map())
}

export async function createMindCardsExamples(root: string): Promise<MindCardsState> {
  const state = await readMindCards(root)
  if (state.folders.length || state.notes.length) throw new Error('Carregue exemplos somente com o MindCards vazio.')
  const examples = [
    {
      name: 'Frontend', title: 'Frontend - React e TypeScript', color: '#1677ff',
      tags: ['frontend', 'react', 'typescript'],
      content: '# Frontend - React e TypeScript\n\n## Contexto\n\nExemplo de acordo tecnico para o squad. Revise antes de adotar.\n\n## Componentes e estado\n\n- Organizar componentes por funcionalidade e manter responsabilidades claras.\n- Tipar propriedades e respostas da API; validar dados externos em tempo de execucao.\n- Reutilizar os componentes e tokens visuais do projeto.\n\n## Estados da interface\n\n- Prever carregamento, vazio, sucesso e erro.\n- Garantir navegacao por teclado e rotulos acessiveis.\n- Conferir o contrato da API com o Backend e os criterios acordados com o Squad.\n'
    },
    {
      name: 'Backend', title: 'Backend - Contratos de API e Node.js', color: '#52c41a',
      tags: ['backend', 'api', 'nodejs'],
      content: '# Backend - Contratos de API e Node.js\n\n## Contexto\n\nExemplo de decisoes de API, nao uma regra obrigatoria para todos os projetos.\n\n## Contrato\n\n- Documentar entradas, respostas, erros e autorizacao antes de integrar a interface.\n- Validar dados na entrada e aplicar permissoes no servidor.\n- Manter regras de negocio independentes da camada HTTP.\n\n## Consistencia\n\n- Definir transacoes quando uma operacao altera varios registros relacionados.\n- Avaliar idempotencia para requisicoes que podem ser repetidas.\n- Alinhar mudancas de contrato com Frontend e cobrir falhas com Qualidade.\n'
    },
    {
      name: 'Qualidade', title: 'Qualidade - Testes e integracao continua', color: '#9b59b6',
      tags: ['qualidade', 'testes', 'ci'],
      content: '# Qualidade - Testes e integracao continua\n\n## Contexto\n\nExemplo de checklist de entrega; adapte aos riscos e ferramentas do projeto.\n\n## Cenarios\n\n- Relacionar cada criterio de aceite a um teste ou verificacao explicita.\n- Cobrir fluxo principal, limites, permissao negada e falhas relevantes.\n- Em correcoes, adicionar uma regressao que reproduza o defeito.\n\n## Pipeline\n\n- Executar verificacao de tipos, lint, testes e build quando disponiveis.\n- Registrar o que foi validado e as limitacoes, sem declarar sucesso sem evidencia.\n- Revisar contratos do Backend e estados da interface com o Frontend.\n'
    },
    {
      name: 'Squad', title: 'Squad - Acordos e regras de negocio', color: '#fa8c16',
      tags: ['squad', 'produto', 'regras-de-negocio'],
      content: '# Squad - Acordos e regras de negocio\n\n## Contexto\n\nExemplo de nota compartilhavel entre produto, desenvolvimento e qualidade.\n\n## Refinamento\n\n- Registrar objetivo, escopo, criterios de aceite e dependencias da historia do PO.\n- Separar regra aprovada, sugestao tecnica e duvida pendente.\n- Identificar quem pode esclarecer ou aprovar mudancas de negocio.\n\n## Exemplo de regra em discussao\n\nCancelamento permitido ate duas horas antes do agendamento.\n\n**Duvidas:** o limite exato esta incluido? Qual fuso horario vale? Existem excecoes?\n\nNao tratar este exemplo como regra aprovada. Confirmar decisoes com o PO e atualizar Frontend, Backend e testes de Qualidade.\n'
    }
  ] as const
  const folders = examples.map(item => ({ id: randomUUID(), name: item.name, color: item.color }))
  const ids = examples.map(() => randomUUID())
  const now = new Date().toISOString()
  const files = new Map<string, string>([['pastas.json', JSON.stringify({ version: 1, folders }, null, 2)]])
  examples.forEach((item, index) => {
    const metadata = mindNoteMetadataSchema.parse({
      id: ids[index], title: item.title, folderId: folders[index].id, tags: [...item.tags],
      links: ids.filter(id => id !== ids[index]), createdAt: now, updatedAt: now
    })
    files.set(`${skillSlug(item.title)}.md`, `---\n${stringify(metadata)}---\n${item.content}`)
  })
  await restoreMindCardsSnapshot(root, files)
  return readMindCards(root)
}

export async function readMindNote(root: string, id: string): Promise<MindNoteDocument> {
  const state = await readMindCards(root)
  const note = state.notes.find(item => item.id === id)
  if (!note) throw new Error('Nota nao encontrada. Atualize o MindCards.')
  return parseNote(note.filePath, await readContained(root, join(root, note.filePath)))
}

export async function saveMindFolder(
  root: string, input: MindFolder, revision: string | null
): Promise<MindCardsState> {
  const folder = mindFolderSchema.parse(input)
  const state = await readMindCards(root)
  if (state.revision !== revision) throw conflict()
  if (state.folders.some(item => item.id !== folder.id && titleKey(item.name) === titleKey(folder.name))) {
    throw new Error('Ja existe uma pasta com este nome.')
  }
  const index = state.folders.findIndex(item => item.id === folder.id)
  if (index < 0) state.folders.push(folder)
  else state.folders[index] = folder
  const path = await directory(root, true)
  await atomicWrite(join(path, 'pastas.json'), JSON.stringify({ version: 1, folders: state.folders }, null, 2))
  return readMindCards(root)
}

export async function deleteMindFolder(root: string, id: string, revision: string | null): Promise<void> {
  const state = await readMindCards(root)
  if (state.revision !== revision) throw conflict()
  if (!state.folders.some(folder => folder.id === id)) throw new Error('Pasta nao encontrada.')
  if (state.notes.some(note => note.folderId === id)) throw new Error('Mova ou exclua as notas antes de excluir a pasta.')
  await atomicWrite(join(await directory(root), 'pastas.json'),
    JSON.stringify({ version: 1, folders: state.folders.filter(folder => folder.id !== id) }, null, 2))
}

export async function saveMindNote(
  root: string, input: MindNoteInput, id?: string, revision?: string
): Promise<MindNoteDocument> {
  const value = mindNoteInputSchema.parse(input)
  if (Buffer.byteLength(value.content) > 2 * 1024 * 1024 - 8192) throw new Error('A nota excede o limite de 2 MB incluindo metadados.')
  const state = await readMindCards(root)
  const previous = id ? state.notes.find(note => note.id === id) : undefined
  if (id && (!previous || previous.revision !== revision)) throw conflict()
  if (!state.folders.some(folder => folder.id === value.folderId)) throw new Error('Selecione uma pasta existente.')
  const links = [...new Set(value.links)]
  if (links.some(link => link === id || !state.notes.some(note => note.id === link))) {
    throw new Error('Selecione apenas notas existentes, diferentes da propria nota.')
  }
  if (state.notes.some(note => note.id !== id && note.folderId === value.folderId && titleKey(note.title) === titleKey(value.title))) {
    throw new Error('Ja existe uma nota com este titulo nesta pasta.')
  }
  const metadata = mindNoteMetadataSchema.parse({
    ...value, links, tags: [...new Set(value.tags)], id: previous?.id ?? randomUUID(),
    createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString()
  })
  let name = previous?.filePath.slice('mindcards/'.length)
  const path = await directory(root)
  if (!name) {
    const slug = skillSlug(value.title)
    name = `${slug}.md`
    let suffix = 2
    const existing = new Set((await fs.readdir(path)).map(file => file.toLocaleLowerCase()))
    while (existing.has(name.toLocaleLowerCase())) name = `${slug}-${suffix++}.md`
  }
  const raw = `---\n${stringify(metadata)}---\n${value.content}`
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Nota maior que 2 MB.')
  if (previous) {
    const current = await readContained(root, join(root, previous.filePath))
    if (digest(current) !== revision) throw conflict()
    await atomicWrite(join(path, name), raw)
  } else {
    await atomicWrite(join(path, name), raw, true)
  }
  return parseNote(`mindcards/${name}`, raw)
}

export async function deleteMindNote(root: string, id: string, revision: string): Promise<void> {
  const note = await readMindNote(root, id)
  if (note.note.revision !== revision) throw conflict()
  const state = await readMindCards(root)
  if (state.notes.some(item => item.links.includes(id))) {
    throw new Error('Remova primeiro os vinculos das notas que fazem referencia a esta nota.')
  }
  await fs.unlink(join(root, note.note.filePath))
}

// Swap the entire reserved area so a failed restore never leaves half of its notes published.
export async function restoreMindCardsSnapshot(root: string, files: Map<string, string> | null): Promise<void> {
  if (files) validateSnapshot(files)
  const canonical = await fs.realpath(root)
  const destination = join(canonical, 'mindcards')
  const staging = join(canonical, `.mindcards-${randomUUID()}.tmp`)
  const previous = join(canonical, `.mindcards-${randomUUID()}.bak`)
  let moved = false
  try {
    await fs.mkdir(staging)
    for (const [name, content] of files ?? []) {
      if (!/^(pastas\.json|[a-z0-9][a-z0-9-]*\.md)$/.test(name)) throw new Error('Caminho MindCards invalido.')
      await fs.writeFile(join(staging, name), content, { flag: 'wx' })
    }
    try {
      await directory(root)
      await fs.rename(destination, previous)
      moved = true
    } catch (error) {
      if (!hasErrorCode(error, 'ENOENT')) throw error
    }
    try { await fs.rename(staging, destination) } catch (error) {
      if (moved) await fs.rename(previous, destination)
      throw error
    }
    if (moved) await fs.rm(previous, { recursive: true })
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}
