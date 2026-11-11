import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import type { MindCardsState, MindFolder, MindNote, MindNoteDocument, MindNoteInput } from '../src/mindcards-model'
import { mindNoteInputSchema } from '../src/mindcards-model'
import { SKILL_CARD_COLORS, SKILL_CARD_COLOR_LABELS } from '../src/skill-colors'
import { ActionButton, ActionIcon } from './Actions'

const VisualMarkdownEditor = lazy(() => import('./VisualMarkdownEditor'))
const empty: MindCardsState = { folders: [], notes: [], revision: null }
type Draft = MindNoteInput & { id?: string; revision?: string }
type Bridge = { postMessage: (message: unknown) => void }

export default function MindCards({ root, api, onDirtyChange, onBusyChange }: {
  root: string | null; api: Bridge; onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void
}): React.JSX.Element {
  const [modal, context] = Modal.useModal()
  const [state, setState] = useState(empty)
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState<string>()
  const [tagFilter, setTagFilter] = useState<string>()
  const [showArchived, setShowArchived] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [reading, setReading] = useState(false)
  const [folder, setFolder] = useState<MindFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null)
  const baseline = useRef('')
  const pending = useRef(false)
  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline.current) || folder !== null

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => {
    const accept = ({ note, content }: MindNoteDocument) => {
      const next: Draft = { id: note.id, revision: note.revision, title: note.title, folderId: note.folderId,
        tags: note.tags, links: note.links, archived: note.archived, content }
      baseline.current = JSON.stringify(next)
      setReading(false)
      setDraft(next)
    }
    const receive = (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'error') {
        setError(message.message)
        pending.current = false
        setBusy(false)
      }
      if (message.root !== root) return
      if (message.type === 'mindCards') {
        setState(message.state)
        setLoaded(true)
        setBusy(false)
        pending.current = false
        setFolder(null)
        if (message.document) accept(message.document)
        if (message.deleted) { setDraft(null); baseline.current = '' }
        setNotice(message.notice ?? '')
      }
      if (message.type === 'mindNote') {
        accept(message.document)
        setBusy(false)
        pending.current = false
        setError('')
        setNotice('')
      }
    }
    window.addEventListener('message', receive)
    if (root) api.postMessage({ type: 'loadMindCards' })
    return () => window.removeEventListener('message', receive)
  }, [root, api])

  const send = (message: unknown) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    api.postMessage(message)
  }
  const discard = async () => {
    if (busy) return false
    if (!dirty) return true
    return Boolean(await modal.confirm({
      title: 'Descartar alteracoes nao salvas?', content: 'Sua nota so e gravada ao salvar.',
      okText: 'Descartar', cancelText: 'Continuar editando'
    }))
  }
  const openNote = async (id: string) => {
    if (!await discard()) return
    send({ type: 'openMindNote', id })
  }
  const createNote = async (folderId?: string) => {
    if (!await discard()) return
    const destination = folderId ?? folderFilter ?? state.folders[0]?.id
    if (!destination) { setError('Crie uma pasta antes de adicionar uma nota.'); return }
    baseline.current = ''
    setReading(false)
    setDraft({ title: '', folderId: destination, tags: [], links: [], content: '' })
    setError('')
    setNotice('')
  }
  const save = () => {
    if (!draft || busy || reading) return
    const parsed = mindNoteInputSchema.safeParse(draft)
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(' ')); return }
    send({ type: 'saveMindNote', value: parsed.data, id: draft.id, revision: draft.revision })
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => current ? { ...current, [key]: value } : current)
  const tags = [...new Set(state.notes.flatMap(note => note.tags))].sort()
  const visibleNotes = state.notes.filter(note => Boolean(note.archived) === showArchived)
  const filtered = state.notes.filter(note =>
    Boolean(note.archived) === showArchived &&
    (!folderFilter || note.folderId === folderFilter) &&
    (!tagFilter || note.tags.includes(tagFilter)) &&
    `${note.title} ${note.tags.join(' ')} ${state.folders.find(folder => folder.id === note.folderId)?.name ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const backlinks = draft?.id ? state.notes.filter(note => note.links.includes(draft.id!)) : []
  const noteLinks = draft ? draft.links.map(id => state.notes.find(note => note.id === id)).filter((note): note is MindNote => Boolean(note)) : []
  const reload = async () => {
    if (!await discard()) return
    setDraft(null)
    send({ type: 'loadMindCards' })
  }

  return <section className="mindcards" aria-label="MindCards">
    {context}
    <header className="topbar mind-topbar">
      <div>
        <Typography.Title className="brand" level={3}>Mind<span>Cards</span></Typography.Title>
        <Typography.Text type="secondary">Uma ideia por nota. Conecte suas regras de negocio.</Typography.Text>
      </div>
      <div className="toolbar-spacer" />
      {root && <Space wrap>
        <ActionButton action={showArchived ? 'back' : 'archive'} disabled={busy} aria-pressed={showArchived}
          onClick={async () => {
            if (!await discard()) return
            setDraft(null)
            setShowArchived(current => !current)
            setFolderFilter(undefined)
            setTagFilter(undefined)
            setSearch('')
          }}>{showArchived ? 'Voltar para notas' : 'Arquivados'}</ActionButton>
        <ActionButton action="refresh" disabled={busy} onClick={() => void reload()}>Atualizar</ActionButton>
        <ActionButton action="backup" disabled={busy || dirty} onClick={() => api.postMessage({ type: 'createBackup' })}>Criar backup</ActionButton>
        <ActionButton action="folder" disabled={busy || dirty} onClick={() => api.postMessage({ type: 'openVault' })}>Abrir biblioteca</ActionButton>
      </Space>}
    </header>
    {error && <Alert className="feedback" type="error" showIcon message={error} closable onClose={() => setError('')} />}
    {!root ? <Card className="welcome-hero">
      <Typography.Title level={2}>Um lugar para suas ideias e regras.</Typography.Title>
      <Typography.Paragraph type="secondary">O MindCards e um modulo separado na mesma biblioteca do SkillVortex. Notas nao sao skills e nao sao publicadas nos agentes.</Typography.Paragraph>
      <Space wrap>
        <ActionButton action="add" type="primary" onClick={() => api.postMessage({ type: 'createVault' })}>Criar biblioteca</ActionButton>
        <ActionButton action="library" onClick={() => api.postMessage({ type: 'openVault' })}>Abrir biblioteca</ActionButton>
      </Space>
    </Card> : <>
      {notice && <Alert className="feedback" type="success" showIcon message={notice} closable onClose={() => setNotice('')} />}
      {!loaded && !error && <div role="status" className="editor-loading">Carregando MindCards...</div>}
      {loaded && <div className={`mind-layout${reading && draft ? ' mind-reading' : ''}`}>
        <aside className="mind-sidebar" aria-label="Pastas do MindCards">
          <div className="mind-section-heading"><Typography.Title level={5}>Pastas</Typography.Title>
            <ActionButton action="add" size="small" aria-label="Nova pasta" title="Nova pasta" disabled={busy || dirty}
              onClick={() => setFolder({ id: crypto.randomUUID(), name: '', color: SKILL_CARD_COLORS[3] })} />
          </div>
          <Button className="mind-folder-button" aria-pressed={!folderFilter} onClick={() => setFolderFilter(undefined)}>
            <ActionIcon action="mindcards" /><span>Todas as notas</span><Tag>{visibleNotes.length}</Tag>
          </Button>
          {state.folders.map(item => <div className="mind-folder-row" key={item.id}>
            <Button className="mind-folder-button" title={item.name} aria-pressed={folderFilter === item.id} onClick={() => setFolderFilter(item.id)}>
              <span style={{ color: item.color }}><ActionIcon action="folder" /></span>
              <span className="mind-folder-name">{item.name}</span>
              <Tag>{visibleNotes.filter(note => note.folderId === item.id).length}</Tag>
            </Button>
            <Button type="text" size="small" aria-label={`Editar pasta ${item.name}`} title="Editar pasta" disabled={busy || dirty}
              icon={<ActionIcon action="edit" />} onClick={() => setFolder({ ...item })} />
          </div>)}
          <Typography.Paragraph type="secondary" className="mind-local-hint">
            Arquivos locais em mindcards/. Sem publicacao automatica.
          </Typography.Paragraph>
        </aside>
        <div className="mind-main">
          {!draft ? <>
            <div className="mind-dashboard-heading">
              <div><Typography.Title level={2}>{showArchived ? 'Notas arquivadas' : state.folders.find(item => item.id === folderFilter)?.name ?? 'Suas notas'}</Typography.Title>
                <Typography.Text type="secondary">{filtered.length} nota(s) · Regras, contexto e conexoes.</Typography.Text></div>
              {!showArchived && <ActionButton action="add" type="primary" disabled={busy || !state.folders.length} onClick={() => void createNote()}>Nova nota</ActionButton>}
            </div>
            <div className="mind-filters">
              <Input aria-label="Buscar notas" prefix={<ActionIcon action="search" />} placeholder="Buscar notas, etiquetas e pastas..."
                value={search} onChange={event => setSearch(event.target.value)} />
              <Select aria-label="Filtrar notas por etiqueta" placeholder="Todas as etiquetas" allowClear value={tagFilter}
                options={tags.map(tag => ({ value: tag, label: tag }))} onChange={setTagFilter} />
            </div>
            {!state.folders.length ? <Card><Empty description="Comece criando uma pasta para suas notas.">
              <Space wrap>
              <ActionButton action="folder" type="primary" onClick={() => setFolder({ id: crypto.randomUUID(), name: '', color: SKILL_CARD_COLORS[3] })}>Criar primeira pasta</ActionButton>
              <ActionButton action="examples" disabled={busy} onClick={async () => {
                if (await modal.confirm({
                  title: 'Carregar quatro cards de exemplo?',
                  content: 'Cria Frontend, Backend, Qualidade e Squad, cada um com uma pasta colorida e uma nota conectada. Os exemplos sao editaveis e nao sao regras aprovadas.',
                  okText: 'Carregar exemplos', cancelText: 'Cancelar'
                })) send({ type: 'createMindCardsExamples' })
              }}>Carregar exemplos</ActionButton>
              </Space>
            </Empty></Card> : !filtered.length ? <Card><Empty description="Nenhuma nota encontrada.">
              {!showArchived && <ActionButton action="add" onClick={() => void createNote()}>Criar nota</ActionButton>}
            </Empty></Card> : <div className="mind-note-grid">
              {[...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(note => {
                const parent = state.folders.find(item => item.id === note.folderId)!
                return <Card className="mind-note-card" key={note.id} style={{ borderTopColor: parent.color }}>
                  <div className="card-top-row">
                    <div className="mind-note-folder" style={{ color: parent.color }}><ActionIcon action="folder" />{parent.name}</div>
                    <ActionButton className="card-archive-button" action={showArchived ? 'restore' : 'archive'} size="small"
                      aria-label={showArchived ? 'Restaurar' : 'Arquivar'} title={showArchived ? 'Restaurar' : 'Arquivar'} disabled={busy}
                      onClick={() => send({ type: 'archiveMindNote', id: note.id, revision: note.revision, archived: !showArchived })} />
                  </div>
                  <Typography.Title level={4}><Button type="link" className="mind-note-title" onClick={() => void openNote(note.id)}>{note.title}</Button></Typography.Title>
                  <div className="mind-note-tags">{note.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</div>
                  <Typography.Text type="secondary">{new Date(note.updatedAt).toLocaleDateString('pt-BR')} · {note.links.length} conexao(oes)</Typography.Text>
                  <ActionButton action="edit" onClick={() => void openNote(note.id)} disabled={busy}>Abrir nota</ActionButton>
                </Card>
              })}
            </div>}
          </> : <section className="mind-note-editor" aria-label="Editor de nota">
            <div className="mind-dashboard-heading">
              <div><Typography.Title level={3}>{reading ? draft.title || 'Leitura da nota' : draft.id ? 'Editando nota' : 'Nova nota'}</Typography.Title>
                <Typography.Text type="secondary">{dirty ? 'Nao salvo' : 'Todas as alteracoes salvas'}</Typography.Text></div>
              <Space wrap>
                <ActionButton action="back" disabled={busy} onClick={async () => { if (await discard()) setDraft(null) }}>Voltar</ActionButton>
                <ActionButton action={reading ? 'edit' : 'read'} aria-pressed={reading} disabled={busy}
                  onClick={() => setReading(current => !current)}>{reading ? 'Voltar a editar' : 'Leitura'}</ActionButton>
                {!reading && draft.id && <ActionButton action="delete" danger disabled={busy} onClick={async () => {
                  if (await modal.confirm({ title: 'Excluir nota?', content: 'O arquivo .md sera removido. Notas referenciadas precisam ser desvinculadas antes.',
                    okText: 'Excluir', cancelText: 'Cancelar', okButtonProps: { danger: true } })) {
                    send({ type: 'deleteMindNote', id: draft.id, revision: draft.revision })
                  }
                }}>Excluir</ActionButton>}
                {!reading && <ActionButton action="save" type="primary" disabled={!dirty || busy} loading={busy} onClick={save}>Salvar nota</ActionButton>}
              </Space>
            </div>
            <Card className="mind-note-details">
              <div className="mind-note-fields">
                <label className="mind-title-field">Titulo *<Input aria-label="Titulo da nota" maxLength={120} value={draft.title} disabled={busy}
                  placeholder="Uma regra ou ideia clara" onChange={event => update('title', event.target.value)} /></label>
                <label>Pasta *<Select aria-label="Pasta da nota" value={draft.folderId} disabled={busy}
                  options={state.folders.map(item => ({ value: item.id, label: item.name }))} onChange={value => update('folderId', value)} /></label>
                <label>Etiquetas<Select aria-label="Etiquetas da nota" mode="tags" tokenSeparators={[',']} value={draft.tags} disabled={busy}
                  options={tags.map(tag => ({ value: tag, label: tag }))} onChange={value => update('tags', value)} placeholder="Ex.: agendamento, cancelamento" /></label>
                <label className="mind-title-field">Notas relacionadas<Select aria-label="Notas relacionadas" mode="multiple" showSearch optionFilterProp="label" value={draft.links} disabled={busy}
                  options={state.notes.filter(note => note.id !== draft.id).map(note => ({ value: note.id, label: note.title }))}
                  onChange={value => update('links', value)} placeholder="Conecte com outras notas" /></label>
              </div>
            </Card>
            <Card className="mind-text-card">
              <Typography.Title level={5}>Texto da nota</Typography.Title>
              <div className="shared-editor-toolbar" ref={setToolbar} />
              <Suspense fallback={<div className="editor-loading">Carregando editor de texto...</div>}>
                <VisualMarkdownEditor key={draft.id ?? 'new'} value={draft.content} readOnly={busy || reading} preserveMetadata={false}
                  toolbar={toolbar} active={!reading} onFocus={() => undefined} label="Texto da nota"
                  hint={reading ? 'Modo leitura. O rascunho e preservado; nenhuma alteracao e salva ao trocar de modo.' : 'Edicao visual. Salvo como arquivo .md na area independente do MindCards.'}
                  htmlWarning="Esta nota contem HTML. Edite o arquivo .md externamente e atualize o MindCards para preservar essas estruturas."
                  onChange={value => update('content', value)} />
              </Suspense>
            </Card>
            <Card className="mind-connections">
              <Typography.Title level={5}><ActionIcon action="link" /> Conexoes</Typography.Title>
              <div><Typography.Text type="secondary">Notas relacionadas</Typography.Text>
                <Space wrap>{noteLinks.map(note => <Button key={note.id} type="link" onClick={() => void openNote(note.id)}>{note.title}</Button>)}
                  {!noteLinks.length && <span>Nenhuma conexao selecionada.</span>}</Space></div>
              <div><Typography.Text type="secondary">Referenciada por</Typography.Text>
                <Space wrap>{backlinks.map(note => <Button key={note.id} type="link" onClick={() => void openNote(note.id)}>{note.title}</Button>)}
                  {!backlinks.length && <span>Nenhuma nota referencia esta nota ainda.</span>}</Space></div>
              {draft.links.some(id => !state.notes.some(note => note.id === id)) &&
                <Alert type="warning" message="Existem referencias removidas externamente. Remova os vinculos ausentes antes de salvar." />}
            </Card>
          </section>}
        </div>
      </div>}
    </>}
    <Modal title={state.folders.some(item => item.id === folder?.id) ? 'Editar pasta' : 'Nova pasta'} open={Boolean(folder)}
      onCancel={() => { if (!busy) setFolder(null) }} confirmLoading={busy} okText="Salvar pasta" cancelText="Cancelar"
      okButtonProps={{ disabled: !folder?.name.trim() || busy }}
      onOk={() => folder && send({ type: 'saveMindFolder', folder, revision: state.revision })}>
      {folder && <div className="mind-folder-form">
        {error && <Alert type="error" showIcon message={error} />}
        <label>Nome *<Input aria-label="Nome da pasta" maxLength={80} value={folder.name} disabled={busy} onChange={event => setFolder({ ...folder, name: event.target.value })} /></label>
        <label>Cor da pasta<Select aria-label="Cor da pasta" value={folder.color} disabled={busy}
          options={SKILL_CARD_COLORS.map(color => ({ value: color, label: <span><span className="skill-color-swatch" style={{ backgroundColor: color }} />{SKILL_CARD_COLOR_LABELS[color]}</span> }))}
          onChange={color => setFolder({ ...folder, color })} /></label>
        {state.folders.some(item => item.id === folder.id) && <ActionButton action="delete" danger disabled={busy}
          onClick={async () => {
            if (await modal.confirm({ title: 'Excluir pasta vazia?', content: 'Pastas com notas nao podem ser excluidas.',
              okText: 'Excluir', cancelText: 'Cancelar', okButtonProps: { danger: true } })) {
              send({ type: 'deleteMindFolder', id: folder.id, revision: state.revision })
              setFolderFilter(current => current === folder.id ? undefined : current)
            }
          }}>Excluir pasta</ActionButton>}
      </div>}
    </Modal>
  </section>
}
