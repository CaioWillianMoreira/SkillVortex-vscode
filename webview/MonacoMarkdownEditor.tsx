import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'

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
}

export default function MonacoMarkdownEditor({
  value,
  readOnly,
  onChange
}: MonacoMarkdownEditorProps): React.JSX.Element {
  return (
    <div className="monaco-editor-shell">
      <Editor
        height="100%"
        language="markdown"
        theme="vs-dark"
        value={value}
        onChange={next => onChange(next ?? '')}
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
  )
}
