import { Extension, type Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface FindMatch { from: number; to: number }
interface FindState { query: string; index: number; matches: FindMatch[] }
export const editorFindKey = new PluginKey<FindState>('editorFind')

export function findEditorMatches(doc: Node, query: string): FindMatch[] {
  if (!query) return []
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  const matches: FindMatch[] = []
  doc.descendants((node, position) => {
    if (!node.isTextblock) return
    const text = node.textBetween(0, node.content.size, '', '\ufffc')
    for (const match of text.matchAll(pattern)) {
      matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length })
    }
    return false
  })
  return matches
}

export function setEditorFind(editor: Editor, query: string, index = 0): void {
  const matches = findEditorMatches(editor.state.doc, query)
  const current = matches.length ? (index % matches.length + matches.length) % matches.length : 0
  const transaction = editor.state.tr.setMeta(editorFindKey, { query, index: current })
  const match = matches[current]
  if (match) transaction.setSelection(TextSelection.create(transaction.doc, match.from, match.to)).scrollIntoView()
  editor.view.dispatch(transaction)
}

export const editorFindPlugin = new Plugin<FindState>({
  key: editorFindKey,
  filterTransaction(transaction) {
    if (!transaction.docChanged &&
        (transaction.getMeta(editorFindKey) || transaction.getMeta('focus') || transaction.getMeta('blur'))) {
      // Tell StarterKit not to append a paragraph for focus/search-only transactions.
      transaction.setMeta('skipTrailingNode', true)
    }
    return true
  },
  state: {
    init: () => ({ query: '', index: 0, matches: [] }),
    apply(transaction, previous) {
      const request: { query: string; index: number } | undefined = transaction.getMeta(editorFindKey)
      if (!request && !transaction.docChanged) return previous
      const query = request?.query ?? previous.query
      const matches = findEditorMatches(transaction.doc, query)
      return { query, matches, index: Math.min(request?.index ?? previous.index, Math.max(0, matches.length - 1)) }
    }
  },
  props: {
    decorations(state) {
      const find = editorFindKey.getState(state)
      return DecorationSet.create(state.doc, find?.matches.map((match, index) =>
        Decoration.inline(match.from, match.to, {
          class: `editor-find-match${index === find.index ? ' editor-find-current' : ''}`
        })) ?? [])
    }
  }
})

export const EditorFind = Extension.create({
  name: 'editorFind',
  addProseMirrorPlugins: () => [editorFindPlugin]
})
