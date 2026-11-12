import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Input, type InputRef } from 'antd'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { replaceMarkdownBody, splitMarkdown } from '../src/markdown-content'
import EditorToolbar, { type EditorCommand } from './EditorToolbar'
import { containsHtmlToken, isTextColor, TextColor } from './TextColor'
import { ActionIcon } from './Actions'
import { EditorFind, editorFindKey, setEditorFind } from './EditorFind'

interface Props {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  toolbar: HTMLElement | null
  active: boolean
  onFocus: () => void
  label?: string
  hint?: string
  preserveMetadata?: boolean
  htmlWarning?: string
}

export default function VisualMarkdownEditor({
  value, readOnly, onChange, toolbar, active, onFocus,
  label = 'Conteudo da skill em texto', hint = 'O texto edita o mesmo Markdown. A sintaxe pode ser normalizada ao editar.',
  preserveMetadata = true,
  htmlWarning = 'Este arquivo contem HTML. Edite no painel Markdown para preservar essas estruturas.'
}: Props): React.JSX.Element {
  const current = useRef(value)
  const change = useRef(onChange)
  const findInput = useRef<InputRef>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  change.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Image, TaskList, TaskItem.configure({ nested: true }), TableKit, TextColor, Markdown, EditorFind
    ],
    content: preserveMetadata ? splitMarkdown(value).body : value,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: instance }) => {
      const next = preserveMetadata ? replaceMarkdownBody(current.current, instance.getMarkdown()) : instance.getMarkdown()
      current.current = next
      change.current(next)
    }
  })
  const selection = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const names: Partial<Record<EditorCommand, string>> = {
        bold: 'bold', italic: 'italic', strike: 'strike', code: 'code', paragraph: 'paragraph',
        bullet: 'bulletList', ordered: 'orderedList', task: 'taskList', quote: 'blockquote', codeBlock: 'codeBlock', link: 'link'
      }
      const active: EditorCommand[] = (Object.keys(names) as EditorCommand[]).filter(command => instance?.isActive(names[command]!))
      for (const level of [1, 2, 3, 4, 5, 6] as const) {
        if (instance?.isActive('heading', { level })) active.push(`h${level}`)
      }
      const disabled: EditorCommand[] = []
      if (!instance?.can().undo()) disabled.push('undo')
      if (!instance?.can().redo()) disabled.push('redo')
      const item = instance?.isActive('taskItem') ? 'taskItem' : 'listItem'
      if (!instance?.can().sinkListItem(item)) disabled.push('indent')
      if (!instance?.can().liftListItem(item)) disabled.push('outdent')
      if (!instance?.isActive('link')) disabled.push('unlink')
      if (instance?.isActive('table')) disabled.push('table')
      const color: unknown = instance?.getAttributes('textColor').color
      return { active, disabled, textColor: isTextColor(color) ? color : null,
        inTable: instance?.isActive('table'), linkHref: instance?.getAttributes('link').href as string | undefined,
        find: instance ? editorFindKey.getState(instance.state) : undefined }
    }
  })
  const containsHtml = useMemo(() => {
    if (!editor?.markdown) return false
    let found = false
    const parser = editor.markdown.instance
    parser.walkTokens(parser.lexer(preserveMetadata ? splitMarkdown(value).body : value), token => { if (containsHtmlToken(token)) found = true })
    return found
  }, [editor, value, preserveMetadata])

  useEffect(() => {
    if (editor && value !== current.current) {
      current.current = value
      editor.commands.setContent(preserveMetadata ? splitMarkdown(value).body : value, { contentType: 'markdown', emitUpdate: false })
    }
  }, [editor, value, preserveMetadata])
  useEffect(() => { editor?.setEditable(!readOnly && !containsHtml, false) }, [editor, readOnly, containsHtml])
  useEffect(() => {
    if (findOpen) findInput.current?.focus({ cursor: 'all' })
  }, [findOpen])
  useEffect(() => {
    if (!active || !editor || containsHtml) return
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      event.stopPropagation()
      const { from, to } = editor.state.selection
      const selected = editor.state.doc.textBetween(from, to, ' ')
      const query = selected || findQuery
      setFindQuery(query)
      setFindOpen(true)
      setEditorFind(editor, query)
      findInput.current?.focus({ cursor: 'all' })
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active, editor, containsHtml, findQuery])
  useEffect(() => {
    if ((!active || containsHtml) && findOpen) {
      setFindOpen(false)
      if (editor) setEditorFind(editor, '')
    }
  }, [active, containsHtml, findOpen, editor])

  const closeFind = () => {
    setFindOpen(false)
    if (editor) {
      setEditorFind(editor, '')
      editor.view.focus()
    }
  }
  const moveFind = (direction: 1 | -1) => {
    if (editor) setEditorFind(editor, findQuery, (selection?.find?.index ?? 0) + direction)
  }

  const run = (command: EditorCommand, href?: string) => {
    if (!editor || readOnly || containsHtml) return
    const chain = editor.chain().focus()
    switch (command) {
      case 'undo': chain.undo().run(); break
      case 'redo': chain.redo().run(); break
      case 'bold': chain.toggleBold().run(); break
      case 'italic': chain.toggleItalic().run(); break
      case 'strike': chain.toggleStrike().run(); break
      case 'code': chain.toggleCode().run(); break
      case 'clear': chain.unsetAllMarks().clearNodes().run(); break
      case 'color': if (isTextColor(href)) chain.setMark('textColor', { color: href }).run(); break
      case 'unsetColor': chain.unsetMark('textColor').run(); break
      case 'paragraph': chain.setParagraph().run(); break
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        chain.toggleHeading({ level: ({ h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 } as const)[command] }).run(); break
      case 'bullet': chain.toggleBulletList().run(); break
      case 'ordered': chain.toggleOrderedList().run(); break
      case 'task': chain.toggleTaskList().run(); break
      case 'indent': chain.sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run(); break
      case 'outdent': chain.liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run(); break
      case 'link': if (href) chain.extendMarkRange('link').setLink({ href }).run(); break
      case 'unlink': chain.unsetLink().run(); break
      case 'quote': chain.toggleBlockquote().run(); break
      case 'codeBlock': chain.toggleCodeBlock().run(); break
      case 'rule': chain.setHorizontalRule().run(); break
      case 'table': chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break
      case 'addRow': chain.addRowAfter().run(); break
      case 'deleteRow': chain.deleteRow().run(); break
      case 'addColumn': chain.addColumnAfter().run(); break
      case 'deleteColumn': chain.deleteColumn().run(); break
      case 'deleteTable': chain.deleteTable().run(); break
    }
  }
  return <div className="visual-markdown-editor" onFocusCapture={onFocus}>
    {active && toolbar && createPortal(<EditorToolbar {...selection} readOnly={readOnly || containsHtml || !editor} run={run} />, toolbar)}
    {findOpen && <div className="editor-find-bar" role="search" aria-label="Busca no editor Texto"
      onKeyDown={event => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeFind()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          moveFind(event.shiftKey ? -1 : 1)
        }
      }}>
      <Input ref={findInput} size="small" aria-label="Buscar no editor Texto" placeholder="Buscar palavras..."
        prefix={<ActionIcon action="search" />} value={findQuery}
        onChange={event => {
          setFindQuery(event.target.value)
          if (editor) setEditorFind(editor, event.target.value)
        }} />
      <span className="editor-find-count" role="status" aria-live="polite">
        {selection?.find?.matches.length ? `${selection.find.index + 1} de ${selection.find.matches.length}` : 'Nenhum resultado'}
      </span>
      <Button size="small" aria-label="Ocorrencia anterior" disabled={!selection?.find?.matches.length}
        onClick={() => moveFind(-1)}>Anterior</Button>
      <Button size="small" aria-label="Proxima ocorrencia" disabled={!selection?.find?.matches.length}
        onClick={() => moveFind(1)}>Proxima</Button>
      <Button size="small" aria-label="Fechar busca" onClick={closeFind}>Fechar</Button>
    </div>}
    {containsHtml ? <Alert type="warning" showIcon message={htmlWarning} />
      : editor ? <EditorContent editor={editor} /> : <div className="editor-loading">Carregando editor de texto...</div>}
    <div className="visual-editor-hint">{hint}</div>
  </div>
}
