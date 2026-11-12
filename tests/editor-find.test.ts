import { expect, test } from '@jest/globals'
import { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin } from '@tiptap/pm/state'
import { editorFindKey, editorFindPlugin, findEditorMatches } from '../webview/EditorFind'

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*' },
    text: { group: 'inline' },
    image: { inline: true, group: 'inline', atom: true }
  },
  marks: { bold: {} }
})

test('finds literal words case-insensitively across formatting without changing the document', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [
      schema.text('Car', [schema.mark('bold')]), schema.text('ga e CARGA; a+b[1].')
    ])
  ])
  const before = doc.toJSON()
  const matches = findEditorMatches(doc, 'carga')
  expect(matches.map(match => doc.textBetween(match.from, match.to))).toEqual(['Carga', 'CARGA'])
  expect(findEditorMatches(doc, 'a+b[1]').map(match => doc.textBetween(match.from, match.to))).toEqual(['a+b[1]'])
  expect(doc.toJSON()).toEqual(before)
})

test('does not join words across paragraphs or inline images', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Car'), schema.node('image'), schema.text('ga')]),
    schema.node('paragraph', null, schema.text('Car')),
    schema.node('paragraph', null, schema.text('ga'))
  ])
  expect(findEditorMatches(doc, 'Carga')).toEqual([])
  const matches = findEditorMatches(doc, 'ga')
  expect(matches).toHaveLength(2)
  expect(matches.map(match => doc.textBetween(match.from, match.to))).toEqual(['ga', 'ga'])
  expect(findEditorMatches(doc, '')).toEqual([])
})

test('refreshes matches after edits, clamps navigation and clears highlights without a document edit', () => {
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('Carga carga')))
  let state = EditorState.create({ doc, plugins: [editorFindPlugin] })
  const search = state.tr.setMeta(editorFindKey, { query: 'carga', index: 1 })
  expect(search.docChanged).toBe(false)
  state = state.apply(search)
  expect(editorFindKey.getState(state)).toMatchObject({ index: 1, matches: [{ from: 1, to: 6 }, { from: 7, to: 12 }] })
  state = state.apply(state.tr.delete(7, 12))
  expect(editorFindKey.getState(state)).toMatchObject({ index: 0, matches: [{ from: 1, to: 6 }] })
  const clear = state.tr.setMeta(editorFindKey, { query: '', index: 0 })
  expect(clear.docChanged).toBe(false)
  state = state.apply(clear)
  expect(editorFindKey.getState(state)?.matches).toEqual([])
})

test('search and focus do not append normalization paragraphs, while real content edits retain normalization', () => {
  const doc = schema.node('doc', null, schema.node('paragraph', null, schema.text('Carga')))
  const normalize = new Plugin({
    appendTransaction(transactions, _previous, state) {
      if (transactions.some(transaction => transaction.getMeta('skipTrailingNode'))) return
      if (state.doc.childCount === 1) return state.tr.insert(state.doc.content.size, schema.node('paragraph'))
    }
  })
  let state = EditorState.create({ doc, plugins: [editorFindPlugin, normalize] })
  for (const meta of ['focus', 'blur']) {
    state = state.applyTransaction(state.tr.setMeta(meta, { event: {} })).state
    expect(state.doc.toJSON()).toEqual(doc.toJSON())
  }
  state = state.applyTransaction(state.tr.setMeta(editorFindKey, { query: 'carga', index: 0 })).state
  expect(state.doc.toJSON()).toEqual(doc.toJSON())
  state = state.applyTransaction(state.tr.insertText(' real edit', 6)).state
  expect(state.doc.childCount).toBe(2)
  expect(state.doc.textContent).toBe('Carga real edit')
})
