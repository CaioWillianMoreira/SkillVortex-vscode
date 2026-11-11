import { readMindNote } from './mindcards'
import type { MindNoteDocument } from './mindcards-model'
import { builderRequestSchema, type BuilderRequest, type BuilderSource } from './product-builder-model'

export async function readBuilderSources(root: string, request: BuilderRequest): Promise<BuilderSource[]> {
  const parsed = builderRequestSchema.parse(request)
  const documents: MindNoteDocument[] = []
  for (const selected of parsed.notes) {
    const document = await readMindNote(root, selected.id)
    if (document.note.revision !== selected.revision) throw new Error('Uma nota mudou. Atualize os cards antes de gerar.')
    if (document.note.archived) throw new Error('Restaure a nota arquivada antes de usa-la no Product Builder.')
    documents.push(document)
  }
  const sources = documents.map(({ note, content }) => ({ id: note.id, title: note.title, content }))
  if (sources.reduce((size, source) => size + source.title.length + source.content.length, parsed.objective.length) > 12000) {
    throw new Error('O contexto excede 12.000 caracteres. Selecione menos notas ou notas menores para o modelo local.')
  }
  return sources
}
