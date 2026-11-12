import Editor, { loader } from '@monaco-editor/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert } from 'antd'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import { formatMarkdown } from '../src/markdown-format'
import { replaceMarkdownBody, splitMarkdown } from '../src/markdown-content'
import EditorToolbar, { type EditorCommand } from './EditorToolbar'
import { createMarkdownSelection } from './markdown-selection'

window.MonacoEnvironment = {
  getWorker: () => new editorWorker()
}
loader.config({ monaco })
monaco.languages.register({ id: 'markdown', extensions: ['.md'], aliases: ['Markdown', 'markdown'] })
monaco.languages.setLanguageConfiguration('markdown', {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '`', close: '`' },
    { open: '[', close: ']' },
    { open: '(', close: ')' }
  ],
  surroundingPairs: [
    { open: '`', close: '`' },
    { open: '[', close: ']' },
    { open: '(', close: ')' }
  ]
})
monaco.languages.setMonarchTokensProvider('markdown', {
  defaultToken: '',
  tokenPostfix: '.md',
  tokenizer: {
    root: [
      [/^#{1,6}\s.*$/, 'keyword'],
      [/^\s*([-*+]|\d+\.)\s/, 'keyword'],
      [/^\s*>.*/, 'comment'],
      [/```.*$/, { token: 'string', next: '@codeblock' }],
      [/`[^`]*`/, 'string'],
      [/\*\*[^*]+\*\*/, 'strong'],
      [/\*[^*]+\*/, 'emphasis'],
      [/!?\[[^\]]+\]\([^)]+\)/, 'string']
    ],
    codeblock: [
      [/^```.*$/, { token: 'string', next: '@pop' }],
      [/.*$/, 'variable.source']
    ]
  }
})

interface MonacoMarkdownEditorProps {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  toolbar: HTMLElement | null
  active: boolean
  onFocus: () => void
}

export default function MonacoMarkdownEditor({
  value,
  readOnly,
  onChange,
  toolbar,
  active,
  onFocus
}: MonacoMarkdownEditorProps): React.JSX.Element {
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const subscriptions = useRef<monaco.IDisposable[]>([])
  const [, setRevision] = useState(0)
  const [error, setError] = useState('')
  const { metadata, body } = splitMarkdown(value)
  useEffect(() => () => subscriptions.current.forEach(subscription => subscription.dispose()), [])
  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return
      const editor = instance.current
      if (!editor) return
      event.preventDefault()
      event.stopPropagation()
      editor.focus()
      editor.trigger('keyboard', 'actions.find', null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active])
  const model = instance.current?.getModel()
  const selection = instance.current?.getSelection()
  const selectionAt = useMemo(() => createMarkdownSelection(value), [value])
  const formatting = model && selection ? selectionAt(metadata.length + model.getOffsetAt(selection.getStartPosition()),
    metadata.length + model.getOffsetAt(selection.getEndPosition())) : { active: [] }
  const run = (command: EditorCommand, href?: string) => {
    const editor = instance.current
    const model = editor?.getModel()
    const selection = editor?.getSelection()
    if (!editor || !model || !selection || readOnly) return
    setError('')
    editor.focus()
    if (command === 'undo' || command === 'redo') { editor.trigger('toolbar', command, null); return }
    if (command === 'addRow' || command === 'deleteRow' || command === 'addColumn' ||
        command === 'deleteColumn' || command === 'deleteTable' || command === 'color' || command === 'unsetColor') return
    try {
      const source = metadata + model.getValue()
      const edit = formatMarkdown(source, metadata.length + model.getOffsetAt(selection.getStartPosition()),
        metadata.length + model.getOffsetAt(selection.getEndPosition()), command, href)
      editor.pushUndoStop()
      editor.executeEdits('toolbar', [{ range: monaco.Range.fromPositions(
        model.getPositionAt(edit.start - metadata.length), model.getPositionAt(edit.end - metadata.length)), text: edit.text }])
      editor.setSelection(monaco.Range.fromPositions(
        model.getPositionAt(edit.selectionStart - metadata.length), model.getPositionAt(edit.selectionEnd - metadata.length)))
      editor.pushUndoStop()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="monaco-editor-shell" onFocusCapture={onFocus}>
      {active && toolbar && createPortal(<EditorToolbar readOnly={readOnly || !model}
        active={formatting.active} linkHref={formatting.linkHref}
        disabled={[...(model?.canUndo() ? [] : ['undo'] as const), ...(model?.canRedo() ? [] : ['redo'] as const),
          ...(formatting.active.includes('link') ? [] : ['unlink'] as const)]}
        run={run} />, toolbar)}
      {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
      {metadata && <details className="protected-markdown-metadata">
        <summary>Cabecalho YAML protegido (somente leitura)</summary>
        <textarea aria-label="Cabecalho YAML protegido" readOnly value={metadata} spellCheck={false} />
      </details>}
      <div className="markdown-body-editor">
      <Editor
        height="100%"
        language="markdown"
        theme="vs-dark"
        value={body}
        onChange={next => {
          if (next !== undefined && next !== body) onChange(replaceMarkdownBody(value, next))
        }}
        onMount={editor => {
          subscriptions.current.forEach(subscription => subscription.dispose())
          instance.current = editor
          const update = () => setRevision(value => value + 1)
          subscriptions.current = [editor.onDidChangeCursorSelection(update), editor.onDidChangeModelContent(update)]
          update()
        }}
        loading={<div className="editor-loading">Carregando Monaco...</div>}
        options={{
          automaticLayout: true,
          readOnly,
          // VS Code forwards webview clipboard commands through execCommand,
          // which cannot paste into Monaco's native EditContext.
          editContext: false,
          fontSize: 15,
          lineHeight: 24,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          padding: { top: 14, bottom: 14 },
          renderLineHighlight: 'line'
        }}
      />
      </div>
    </div>
  )
}
