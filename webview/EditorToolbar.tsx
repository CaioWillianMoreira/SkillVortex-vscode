import { useState } from 'react'
import { Alert, Button, Input, Modal, Space, Tooltip } from 'antd'
import type { MarkdownCommand } from '../src/markdown-format'
import { isTextColor } from './TextColor'

export type EditorCommand = MarkdownCommand | 'undo' | 'redo' | 'addRow' | 'deleteRow' |
  'addColumn' | 'deleteColumn' | 'deleteTable' | 'color' | 'unsetColor'

const groups: Array<{ label: string; tools: Array<[EditorCommand, string]> }> = [
  { label: 'Historico', tools: [['undo', 'Desfazer'], ['redo', 'Refazer']] },
  { label: 'Formatacao', tools: [['bold', 'Negrito'], ['italic', 'Italico'], ['strike', 'Riscado'],
    ['code', 'Codigo em linha'], ['clear', 'Limpar formatacao']] },
  { label: 'Paragrafo e titulos', tools: [['paragraph', 'Paragrafo'], ['h1', 'Titulo 1'], ['h2', 'Titulo 2'],
    ['h3', 'Titulo 3'], ['h4', 'Titulo 4'], ['h5', 'Titulo 5'], ['h6', 'Titulo 6']] },
  { label: 'Listas e recuos', tools: [['bullet', 'Lista com marcadores'], ['ordered', 'Lista numerada'],
    ['task', 'Lista de tarefas'], ['indent', 'Aumentar recuo'], ['outdent', 'Diminuir recuo']] },
  { label: 'Inserir', tools: [['link', 'Inserir link'], ['unlink', 'Remover link'], ['quote', 'Citacao'],
    ['codeBlock', 'Bloco de codigo'], ['rule', 'Linha horizontal'], ['table', 'Inserir tabela']] },
  { label: 'Editar tabela', tools: [['addRow', 'Adicionar linha'], ['deleteRow', 'Excluir linha'],
    ['addColumn', 'Adicionar coluna'], ['deleteColumn', 'Excluir coluna'], ['deleteTable', 'Excluir tabela']] }
]

const paths: Partial<Record<EditorCommand, string>> = {
  undo: 'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zm0 8h7a4 4 0 0 1 0 8H7z',
  italic: 'M11 4h8M5 20h8M15 4 9 20',
  strike: 'M18 6c-2-3-11-3-11 2 0 2 3 3 5 3M6 17c2 5 12 4 12-1 0-2-2-3-5-3M3 12h18',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  clear: 'm14 3 7 7-10 11H5l-4-4zM7 11l8 8M12 21h10',
  color: 'm5 17 7-14 7 14M8 12h8M3 22h18',
  unsetColor: 'm5 17 7-14 7 14M8 12h8M3 22h18M3 3l18 18',
  paragraph: 'M13 21V3h7M17 3v18M13 3H9a5 5 0 0 0 0 10h4',
  bullet: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',
  ordered: 'M10 5h12M10 12h12M10 19h12M2 3h2v5M2 12c4-3 5 1 0 5h4M2 20h4',
  task: 'M10 5h12M10 12h12M10 19h12M2 4l2 2 3-4M2 11l2 2 3-4M2 18l2 2 3-4',
  indent: 'M10 4h12M10 9h12M10 15h12M10 20h12M2 8l4 4-4 4',
  outdent: 'M10 4h12M10 9h12M10 15h12M10 20h12M6 8l-4 4 4 4',
  link: 'm10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2',
  unlink: 'M3 3l18 18M8 16l-2 2a4 4 0 0 1-6-6l4-4m10 8a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2',
  quote: 'M3 12h6v8H2V10l4-6h4l-7 8zm12 0h6v8h-7V10l4-6h4l-7 8z',
  codeBlock: 'M3 3h18v18H3zM8 9l-3 3 3 3m8-6 3 3-3 3M13 7l-2 10',
  rule: 'M3 12h18',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  addRow: 'M3 3h18v10H3zM3 8h18M12 16v6M9 19h6',
  deleteRow: 'M3 3h18v10H3zM3 8h18M9 19h6',
  addColumn: 'M3 3h10v18H3zM8 3v18M19 9v6M16 12h6',
  deleteColumn: 'M3 3h10v18H3zM8 3v18M16 12h6',
  deleteTable: 'M3 3h18v18H3zM3 9h18M9 3v18M14 14l5 5M19 14l-5 5'
}

function ToolIcon({ command }: { command: EditorCommand }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {command.startsWith('h') ? <text x="1" y="17" fill="currentColor" stroke="none" fontSize="16"
      fontWeight="600">{command.toUpperCase()}</text> : <path d={paths[command]} />}
  </svg>
}

export interface EditorToolbarProps {
  readOnly: boolean
  contentReadOnly?: boolean
  active?: EditorCommand[]
  disabled?: EditorCommand[]
  inTable?: boolean
  linkHref?: string
  textColor?: string | null
  run: (command: EditorCommand, href?: string) => void
}

export default function EditorToolbar({ readOnly, contentReadOnly, active = [], disabled = [], inTable, linkHref = '', textColor, run }: EditorToolbarProps): React.JSX.Element {
  const [linkOpen, setLinkOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [colorOpen, setColorOpen] = useState(false)
  const [color, setColor] = useState('#69b1ff')
  return <>
    <div className="visual-editor-toolbar" role="toolbar" aria-label="Formatacao do editor">
      {textColor !== undefined && <div className="visual-editor-tool-group" role="group" aria-label="Cor do texto">
        <span className="visual-editor-group-label">Cor do texto</span>
        <div className="visual-editor-group-buttons">
          <Tooltip title="Cor do texto"><Button className="visual-editor-tool" size="small" aria-label="Cor do texto"
            disabled={readOnly || contentReadOnly} aria-pressed={Boolean(textColor)}
            onMouseDown={event => event.preventDefault()} onClick={() => {
              setColor(textColor ?? '#69b1ff'); setColorOpen(true)
            }} icon={<span style={{ borderBottom: `3px solid ${textColor ?? '#69b1ff'}` }}><ToolIcon command="color" /></span>} /></Tooltip>
          <Tooltip title="Remover cor"><Button className="visual-editor-tool" size="small" aria-label="Remover cor"
            disabled={readOnly || contentReadOnly || !textColor} onMouseDown={event => event.preventDefault()}
            onClick={() => run('unsetColor')} icon={<ToolIcon command="unsetColor" />} /></Tooltip>
        </div>
      </div>}
      {groups.filter(group => group.label !== 'Editar tabela' || inTable).map(group =>
        <div key={group.label} className="visual-editor-tool-group" role="group" aria-label={group.label}>
          <span className="visual-editor-group-label">{group.label}</span>
          <div className="visual-editor-group-buttons">
            {group.tools.map(([command, label]) => <Tooltip key={command} title={label}>
              <Button className="visual-editor-tool" size="small" aria-label={label} aria-pressed={active.includes(command)}
                disabled={readOnly || (contentReadOnly && command !== 'undo' && command !== 'redo') || disabled.includes(command)}
                icon={<ToolIcon command={command} />}
                onMouseDown={event => event.preventDefault()} onClick={() => {
                  if (command === 'link') { setUrl(linkHref); setError(''); setLinkOpen(true) }
                  else run(command)
                }} />
            </Tooltip>)}
          </div>
          <Modal title="Cor do texto" open={colorOpen} okText="Aplicar cor" cancelText="Cancelar"
            onCancel={() => setColorOpen(false)} okButtonProps={{ disabled: readOnly || !isTextColor(color) }}
            onOk={() => { if (isTextColor(color)) { run('color', color); setColorOpen(false) } }}>
            <Space direction="vertical">
              <label>Escolha uma cor<Input type="color" aria-label="Escolher cor do texto"
                value={isTextColor(color) ? color : '#69b1ff'} onChange={event => setColor(event.target.value)} /></label>
              <Input aria-label="Codigo da cor" value={color} maxLength={7} onChange={event => setColor(event.target.value)}
                status={isTextColor(color) ? undefined : 'error'} />
              <span>A cor sera salva no .md como um span HTML controlado.</span>
            </Space>
          </Modal>
        </div>)}
    </div>
    <Modal title="Inserir link" open={linkOpen} okText="Aplicar" cancelText="Cancelar"
      okButtonProps={{ disabled: readOnly }} onCancel={() => setLinkOpen(false)} onOk={() => {
        const href = url.trim()
        if (!/^(https?:\/\/|mailto:|#|\.{0,2}\/)/i.test(href)) {
          setError('Use um endereco http(s), mailto, ancora ou caminho relativo.')
          return
        }
        run('link', href)
        setLinkOpen(false)
      }}>
      <Space direction="vertical" className="full-width">
        <Input aria-label="Endereco do link" value={url} onChange={event => setUrl(event.target.value)} />
        {error && <Alert type="error" message={error} />}
      </Space>
    </Modal>
  </>
}
