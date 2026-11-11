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
      name: 'Acessibilidade', title: 'Acessibilidade - Criterios para interfaces inclusivas', color: '#1677ff',
      tags: ['acessibilidade', 'wcag', 'frontend'],
      content: '# Acessibilidade\n\n## Contexto\n\nExemplo de politica de qualidade para interfaces web, baseado na WCAG 2.2. Adapte ao produto antes de aprovar; este checklist nao comprova conformidade completa.\n\n## Regras\n\n- Permitir executar as acoes por teclado, sem prender o foco, com ordem coerente e indicador de foco visivel.\n- Dar nome acessivel aos controles e associar rotulos aos campos. Identificar erros em texto; nao depender somente de cor.\n- Fornecer alternativa textual para imagens informativas; imagens puramente decorativas usam alt vazio.\n- Manter contraste minimo de 4,5:1 para texto comum e 3:1 para texto grande (pelo menos 18 pt ou 14 pt em negrito). A WCAG preve excecoes, como logotipos, decoracao e controles inativos.\n- Usar elementos HTML nativos adequados antes de adicionar ARIA e preservar nome, funcao e estado dos controles.\n\n## Criterios de aceite\n\n- Concluir o fluxo principal somente com teclado e conferir foco ao abrir e fechar dialogos.\n- Verificar rotulos, erros e imagens com leitor de tela; medir contraste, inclusive nos estados interativos.\n- Combinar verificacao automatizada com revisao manual, sem tratar ausencia de alertas como garantia de acessibilidade.\n\n## Fontes\n\n- [W3C - WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)\n- [W3C - Contraste minimo, criterio 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)\n'
    },
    {
      name: 'HTML e CSS', title: 'HTML e CSS - Estrutura semantica e layout responsivo', color: '#52c41a',
      tags: ['html', 'css', 'responsividade'],
      content: '# Boas praticas de HTML e CSS\n\n## Contexto\n\nExemplo de acordo tecnico para paginas web, sintetizado a partir da MDN. Sao criterios de qualidade propostos, nao regras de negocio aprovadas automaticamente.\n\n## Regras\n\n- Escolher elementos pelo significado: main para conteudo principal, nav para navegacao e headings para organizar secoes. Nao escolher tags apenas pela aparencia.\n- Usar button para acoes e a com href para navegacao; evitar div clicavel como substituto de controles nativos.\n- Separar estrutura HTML de apresentacao CSS; reutilizar estilos e convencoes existentes no projeto.\n- Construir layouts fluidos com Flexbox ou Grid e adaptar pontos de quebra ao conteudo, nao apenas a modelos de aparelhos.\n- Impedir que imagens e outros meios ultrapassem seu container; manter proporcao e testar textos longos.\n- Evitar larguras fixas que provoquem rolagem horizontal desnecessaria em telas estreitas.\n\n## Criterios de aceite\n\n- Conferir a hierarquia de titulos e a navegacao por teclado.\n- Testar celular, desktop, zoom e conteudo longo sem sobreposicao ou perda de informacao.\n- Validar HTML e revisar CSS nos navegadores suportados pelo produto.\n\n## Fontes\n\n- [MDN - Estrutura de documentos](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Structuring_documents)\n- [MDN - Design responsivo](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design)\n'
    },
    {
      name: 'SEO', title: 'SEO - Criterios para paginas publicas', color: '#9b59b6',
      tags: ['seo', 'conteudo', 'indexacao'],
      content: '# Regras de SEO\n\n## Contexto\n\nExemplo de politica para paginas publicas que devem ser encontradas em buscadores, baseado no Google Search Central. Aplicar apenas ao conteudo destinado a indexacao; SEO nao garante posicao nem inclusao no indice.\n\n## Regras\n\n- Publicar conteudo util, original e voltado ao usuario, com titulos descritivos e organizacao compreensivel.\n- Definir title especifico para cada pagina e meta description relevante; o Google pode escolher outro titulo ou trecho nos resultados.\n- Usar URLs descritivas e links rastreaveis com a e href, com texto que explique o destino.\n- Permitir acesso do buscador ao conteudo publico e aos recursos necessarios a renderizacao, como CSS e JavaScript.\n- Revisar duplicacoes e indicar URL canonica quando aplicavel. Considerar sitemap para facilitar a descoberta de URLs importantes.\n- Definir quais paginas podem ser indexadas. Nao usar robots.txt como protecao de dados privados nem como garantia de desindexacao; conteudo privado exige controle de acesso.\n\n## Criterios de aceite\n\n- Revisar title, descricao, links, resposta HTTP e visibilidade do conteudo publico.\n- Conferir a pagina renderizada e a elegibilidade de indexacao com a inspecao de URL do Search Console.\n- Monitorar resultados apos publicacao, sem prometer ganhos imediatos ou primeira posicao.\n\n## Fontes\n\n- [Google Search Central - Guia de SEO para iniciantes](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)\n'
    },
    {
      name: 'Testes', title: 'Testes - Cenarios confiaveis e regressao', color: '#fa8c16',
      tags: ['testes', 'qualidade', 'playwright'],
      content: '# Boas praticas de testes\n\n## Contexto\n\nExemplo de acordo de qualidade, baseado nas recomendacoes do Playwright para testes de interface. Ajuste ferramentas e cobertura aos riscos do produto; percentual de cobertura isolado nao comprova qualidade.\n\n## Regras\n\n- Verificar comportamentos observaveis pelo usuario, nao detalhes internos da implementacao.\n- Manter cada teste independente, com dados e estado controlados; nao depender da ordem de execucao.\n- Priorizar localizadores por papel acessivel, nome e rotulo; evitar seletores CSS ou XPath frageis.\n- Usar espera automatica e assercoes que aguardam a condicao, em vez de pausas fixas arbitrarias.\n- Simular servicos externos que nao estao sob controle da equipe e validar integracoes proprias em ambiente apropriado.\n- Relacionar criterios de aceite a cenarios: sucesso, limites, erros e permissoes. Em correcoes, adicionar teste de regressao para o defeito.\n\n## Criterios de aceite\n\n- Executar o teste isoladamente e junto da suite sem depender de dados de producao.\n- Cobrir o fluxo principal e pelo menos as falhas relevantes ao risco da mudanca.\n- Registrar comando, resultado e limitacoes; investigar intermitencias em vez de esconder falhas com repeticoes indiscriminadas.\n\n## Fontes\n\n- [Playwright - Best Practices](https://playwright.dev/docs/best-practices)\n'
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
  const files = await mindCardsSnapshot(root)
  if (!files) throw conflict()
  const state = validateSnapshot(files)
  const note = state.notes.find(item => item.id === id)
  if (!note || note.revision !== revision) throw conflict()
  const updated = new Map(files)
  updated.delete(note.filePath.slice('mindcards/'.length))
  for (const reference of state.notes.filter(item => item.links.includes(id))) {
    const name = reference.filePath.slice('mindcards/'.length)
    const { metadata, body } = splitMarkdown(files.get(name)!)
    const yaml = parseDocument(metadata!.replace(/^\uFEFF?---\r?\n/, '').replace(/\r?\n---(?:\r?\n)?$/, ''))
    yaml.set('links', reference.links.filter(link => link !== id))
    yaml.set('updatedAt', new Date().toISOString())
    updated.set(name, `---\n${yaml.toString()}---\n${body}`)
  }
  const current = await mindCardsSnapshot(root)
  if (!current || current.size !== files.size || [...files].some(([name, raw]) => current.get(name) !== raw)) throw conflict()
  await restoreMindCardsSnapshot(root, updated)
}

export async function setMindNoteArchived(root: string, id: string, revision: string, archived: boolean): Promise<void> {
  const document = await readMindNote(root, id)
  await saveMindNote(root, { ...document.note, content: document.content, archived }, id, revision)
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
