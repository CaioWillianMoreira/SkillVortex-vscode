import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Alert } from 'antd'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Markdown } from '@tiptap/markdown'
import { replaceMarkdownBody, splitMarkdown } from '../src/markdown-content'
import EditorToolbar, { type EditorCommand } from './EditorToolbar'

interface Props {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  toolbar: HTMLElement | null
  active: boolean
  onFocus: () => void
}

export default function VisualMarkdownEditor({ value, readOnly, onChange, toolbar, active, onFocus }: Props): React.JSX.Element {
  const current = useRef(value)
  const change = useRef(onChange)
  change.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Image, TaskList, TaskItem.configure({ nested: true }), TableKit, Markdown
    ],
    content: splitMarkdown(value).body,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: { attributes: { 'aria-label': 'Conteudo da skill em texto', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: instance }) => {
      const next = replaceMarkdownBody(current.current, instance.getMarkdown())
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
      return { active, disabled, inTable: instance?.isActive('table'), linkHref: instance?.getAttributes('link').href as string | undefined }
    }
  })
  const containsHtml = useMemo(() => {
    if (!editor?.markdown) return false
    let found = false
    const parser = editor.markdown.instance
    parser.walkTokens(parser.lexer(splitMarkdown(value).body), token => { if (token.type === 'html') found = true })
    return found
  }, [editor, value])

  useEffect(() => {
    if (editor && value !== current.current) {
      current.current = value
      editor.commands.setContent(splitMarkdown(value).body, { contentType: 'markdown', emitUpdate: false })
    }
  }, [editor, value])
  useEffect(() => { editor?.setEditable(!readOnly && !containsHtml, false) }, [editor, readOnly, containsHtml])

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
    {containsHtml ? <Alert type="warning" showIcon message="Este arquivo contem HTML. Edite no painel Markdown para preservar essas estruturas." />
      : editor ? <EditorContent editor={editor} /> : <div className="editor-loading">Carregando editor de texto...</div>}
    <div className="visual-editor-hint">O texto edita o mesmo Markdown. A sintaxe pode ser normalizada ao editar.</div>
  </div>
}
