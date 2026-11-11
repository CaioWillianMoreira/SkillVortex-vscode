import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Alert, Button, Card, Checkbox, Col, ConfigProvider, Dropdown, Empty, Input, Modal, Row,
  Select, Space, Switch, Tabs, Tag, Tooltip, Typography, theme
} from 'antd'
import { ActionButton, ActionIcon } from './Actions'
import MindCards from './MindCards'
import type { Catalog, Projects, Skill, SkillCard, SkillAgent } from '../src/model'
import { isAgentLinked, isCollectionLinked, selectedSkillIds, skillCards, skillRegistrationSchema } from '../src/model'
import {
  categoryColor, isSkillCardColor, SKILL_CARD_COLOR_LABELS, SKILL_CARD_COLORS, skillCardTextColor
} from '../src/skill-colors'
import dashboardPreview from './assets/dashboard-preview.png'
import editorPreview from './assets/editor-preview.png'
import './styles.css'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()
const MonacoMarkdownEditor = lazy(() => import('./MonacoMarkdownEditor'))
const VisualMarkdownEditor = lazy(() => import('./VisualMarkdownEditor'))
const labels = { allowed: 'Liberada', blocked: 'Bloqueada' }
const colors = { allowed: 'green', blocked: 'red' }
const statusNames = ['allowed', 'blocked'] as const
function HelpTip({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return <Tooltip title={children} trigger={['hover', 'focus']} destroyOnHidden open={open} onOpenChange={setOpen}>
    <Button type="text" size="small" aria-label={label} icon={<ActionIcon action="info" />}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }} />
  </Tooltip>
}
type Status = typeof statusNames[number]
type AppState = {
  root: string | null
  catalog: Catalog | null
  projects: Projects | null
  publishedMarkdown?: string[]
  hasProjectMarkdown?: boolean
  editingSkillId: string | null
  content: string
  saved?: boolean
  creating?: boolean
  externalChanges?: Array<{ skillId: string; name: string; libraryChanged: boolean; publications: number }>
}
type Draft = Skill & { content: string; projectIds: string[] }

const emptyState: AppState = {
  root: null, catalog: null, projects: null, editingSkillId: null, content: ''
}
const AUTOMATIC_COLOR = 'auto'
const cardColorOptions = [
  { value: AUTOMATIC_COLOR, label: 'Automatica (categoria)' },
  ...SKILL_CARD_COLORS.map(color => ({
    value: color,
    label: (
      <span>
        <span className="skill-color-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
        {SKILL_CARD_COLOR_LABELS[color]}
      </span>
    )
  }))
]

function App(): React.JSX.Element {
  const [area, setArea] = useState<'home' | 'skills' | 'mindcards'>('home')
  const [mindDirty, setMindDirty] = useState(false)
  const [mindBusy, setMindBusy] = useState(false)
  useEffect(() => {
    document.body.dataset.workspace = area
    return () => { delete document.body.dataset.workspace }
  }, [area])
  const [modal, modalContext] = Modal.useModal()
  const [state, setState] = useState<AppState>(emptyState)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>()
  const [agentFilter, setAgentFilter] = useState<string>()
  const [categoryName, setCategoryName] = useState('')
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [collectionFilter, setCollectionFilter] = useState<string>()
  const [collectionEditorOpen, setCollectionEditorOpen] = useState(false)
  const [collectionId, setCollectionId] = useState<string>()
  const [collectionName, setCollectionName] = useState('')
  const [collectionSkillIds, setCollectionSkillIds] = useState<string[]>([])
  const [collectionDisabledSkillIds, setCollectionDisabledSkillIds] = useState<string[]>([])
  const [collectionCategory, setCollectionCategory] = useState('')
  const [collectionDescription, setCollectionDescription] = useState('')
  const [collectionTags, setCollectionTags] = useState<string[]>([])
  const [collectionAgents, setCollectionAgents] = useState<string[]>([])
  const [collectionStatus, setCollectionStatus] = useState<Skill['status']>('allowed')
  const [collectionColor, setCollectionColor] = useState<Skill['cardColor']>()
  const [runningCard, setRunningCard] = useState<SkillCard | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [editorMode, setEditorMode] = useState<'markdown' | 'text'>('text')
  const [editorToolbar, setEditorToolbar] = useState<HTMLDivElement | null>(null)
  const baseline = useRef('')

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'state') {
        setState(event.data as AppState)
        setError('')
        setNotice('')
      }
      if (event.data.type === 'error') {
        setError(event.data.message)
        setSaving(false)
      }
      if (event.data.type === 'externalChanges') {
        setState(current => ({ ...current, externalChanges: event.data.externalChanges }))
      }
      if (event.data.type === 'state' && event.data.saved) {
        setCollectionEditorOpen(false)
        setNotice('Alteracoes salvas na biblioteca.')
        setSaving(false)
      }
    }
    document.getElementById('runtime-fallback')?.remove()
    window.addEventListener('message', handler)
    api.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', handler)
  }, [])

  const activeProject = state.projects?.projects.find(project => project.id === state.projects?.activeProject)
  const allCards = useMemo(() => state.catalog ? skillCards(state.catalog) : [], [state.catalog])
  const agentLabels = useMemo(() => [...new Set(allCards.flatMap(item => item.agents))]
    .sort((a, b) => a.localeCompare(b)), [allCards])
  useEffect(() => {
    if (agentFilter && !agentLabels.includes(agentFilter)) setAgentFilter(undefined)
  }, [agentLabels, agentFilter])
  useEffect(() => {
    if (categoryFilter && state.catalog && !state.catalog.categories.includes(categoryFilter)) {
      setCategoryFilter(undefined)
    }
  }, [state.catalog, categoryFilter])
  useEffect(() => {
    if (collectionFilter && state.catalog && !state.catalog.collections?.some(item => item.id === collectionFilter)) {
      setCollectionFilter(undefined)
    }
  }, [state.catalog, collectionFilter])
  const skill = state.catalog?.skills.find(item => item.id === state.editingSkillId)
  useEffect(() => {
    if (!skill || !state.projects) {
      setDraft(null)
      baseline.current = ''
      return
    }
    const next: Draft = {
      ...skill,
      content: state.content,
      projectIds: state.projects.projects
        .filter(project => project.skillIds.includes(skill.id))
        .map(project => project.id)
    }
    setDraft(next)
    baseline.current = JSON.stringify(next)
  }, [state.editingSkillId, state.content, state.catalog, state.projects])

  const dirty = Boolean(draft && (state.creating || JSON.stringify(draft) !== baseline.current))
  const cards = useMemo(() => allCards.filter(item => {
    const matchesText = [
      item.name, item.description, item.category, ...item.tags, ...item.agents,
      ...(state.catalog?.skills.filter(skill => item.skillIds.includes(skill.id)).map(skill => skill.name) ?? [])
    ].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())
    return Boolean(item.archived) === showArchived && matchesText &&
      (statusFilter === 'all' || item.status === statusFilter) &&
      (!categoryFilter || item.category === categoryFilter) &&
      (!agentFilter || item.agents.includes(agentFilter)) &&
      (!collectionFilter || item.id === collectionFilter)
  }), [allCards, state.catalog, search, statusFilter, categoryFilter, agentFilter, collectionFilter, showArchived])
  const cardCount = cards.length
  const editCollection = (existing?: SkillCard) => {
    setCollectionId(existing?.id)
    setCollectionName(existing?.name ?? '')
    setCollectionSkillIds(existing?.skillIds ?? [])
    setCollectionDisabledSkillIds(existing?.disabledSkillIds ?? [])
    setCollectionCategory(existing?.category ?? state.catalog?.categories[0] ?? '')
    setCollectionDescription(existing?.description ?? 'Conjunto de skills para usar no projeto.')
    setCollectionTags(existing?.tags ?? ['conjunto'])
    setCollectionAgents(existing?.agents ?? ['GitHub Copilot', 'Antigravity'])
    setCollectionStatus(existing?.status ?? 'allowed')
    setCollectionColor(existing?.cardColor)
    setError('')
    setCollectionEditorOpen(true)
  }
  const deleteCategory = (category: string) => {
    if (state.catalog?.skills.some(item => item.category === category) ||
        allCards.some(item => item.category === category)) {
      modal.info({ title: 'Categoria em uso',
        content: 'Mova as skills e cards para outra categoria antes de excluir.', okText: 'Entendi' })
      return
    }
    modal.confirm({
      title: 'Excluir categoria?', content: `Excluir "${category}"? Nenhuma skill sera apagada.`,
      okText: 'Excluir categoria', cancelText: 'Cancelar',
      okButtonProps: { className: 'action-button action-delete', icon: <ActionIcon action="delete" /> },
      onOk: () => api.postMessage({ type: 'deleteCategory', name: category })
    })
  }

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(current => current ? { ...current, [key]: value } : current)
  }
  const leaveEditor = () => {
    if (!dirty) {
      api.postMessage({ type: 'backToDashboard' })
      return
    }
    modal.confirm({
      title: 'Descartar alteracoes?',
      content: 'As alteracoes nao salvas desta skill serao perdidas.',
      okText: 'Descartar',
      cancelText: 'Continuar editando',
      okButtonProps: { danger: true, className: 'action-button action-delete', icon: <ActionIcon action="delete" /> },
      cancelButtonProps: { className: 'action-button action-back', icon: <ActionIcon action="back" /> },
      onOk: () => api.postMessage({ type: 'backToDashboard' })
    })
  }
  const saveDraft = () => {
    if (area !== 'skills') return
    if (!draft || !dirty || saving) return
    const validation = skillRegistrationSchema.safeParse(draft)
    if (!validation.success) {
      setError(validation.error.issues.map(issue => issue.message).join(' '))
      return
    }
    setSaving(true)
    api.postMessage({
      type: 'saveSkill',
      id: draft.id,
      name: draft.name,
      category: draft.category,
      description: draft.description,
      tags: draft.tags,
      agents: draft.agents,
      status: draft.status,
      cardColor: draft.cardColor ?? null,
      content: draft.content,
      projectIds: draft.status === 'blocked' ? [] : draft.projectIds
    })
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (area === 'skills' && (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        saveDraft()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })

  const navigate = async (next: typeof area) => {
    if (next === area || saving || mindBusy) return
    if ((area === 'skills' && (dirty || collectionEditorOpen)) || (area === 'mindcards' && mindDirty)) {
      if (!await modal.confirm({ title: 'Descartar alteracoes nao salvas?', content: 'Salve antes de trocar de area para manter seu rascunho.',
        okText: 'Descartar e trocar', cancelText: 'Continuar editando' })) return
      if (area === 'skills') api.postMessage({ type: 'backToDashboard' })
      setCollectionEditorOpen(false)
    }
    setMindDirty(false)
    setArea(next)
  }

  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: { colorPrimary: area === 'mindcards' ? '#1677ff' : '#ff4d4f',
        ...(area === 'mindcards' ? {
          colorInfo: '#1677ff', colorLink: '#69b1ff', colorLinkHover: '#91caff'
        } : {}),
        colorBgContainer: '#171717', borderRadius: 8,
        fontSize: 15, controlHeight: 38, controlHeightSM: 34, colorTextSecondary: '#b8b8b8' },
      components: { Select: { optionHeight: 38 }, Dropdown: { paddingBlock: 8 } }
    }}>
      {modalContext}
      <main>
        <nav className="workspace-navigation" aria-label="Areas de trabalho">
          <ActionButton action="home" aria-label="Escolher tela inicial" onClick={() => void navigate('home')} disabled={saving || mindBusy}>Inicio</ActionButton>
          <ActionButton action="library" aria-pressed={area === 'skills'} onClick={() => void navigate('skills')} disabled={saving || mindBusy}>SkillVortex</ActionButton>
          <ActionButton action="mindcards" aria-pressed={area === 'mindcards'} onClick={() => void navigate('mindcards')} disabled={saving || mindBusy}>MindCards</ActionButton>
        </nav>
        {area === 'home' && <section className="area-chooser">
          <Typography.Text className="welcome-eyebrow">SEU ESPACO DE TRABALHO</Typography.Text>
          <Typography.Title level={1}>Por onde vamos comecar?</Typography.Title>
          <Typography.Paragraph type="secondary">Escolha uma area. Voce pode trocar a qualquer momento pelo menu acima.</Typography.Paragraph>
          <div className="area-choices">
            <Card className="area-choice">
              <ActionIcon action="library" />
              <Typography.Title level={2}>SkillVortex</Typography.Title>
              <Typography.Paragraph type="secondary">Organize skills e controle sua publicacao nos projetos e agentes.</Typography.Paragraph>
              <ActionButton action="library" type="primary" onClick={() => void navigate('skills')}>Abrir SkillVortex</ActionButton>
            </Card>
            <Card className="area-choice mind-choice">
              <ActionIcon action="mindcards" />
              <Typography.Title level={2}>MindCards</Typography.Title>
              <Typography.Paragraph type="secondary">Conecte ideias e regras de negocio em notas locais, com pastas coloridas.</Typography.Paragraph>
              <ActionButton action="mindcards" type="primary" onClick={() => void navigate('mindcards')}>Abrir MindCards</ActionButton>
            </Card>
          </div>
        </section>}
        {area === 'mindcards' && <MindCards key={state.root} root={state.root} api={api} onDirtyChange={setMindDirty} onBusyChange={setMindBusy} />}
        {area === 'skills' && <>
        <header className="topbar">
          <Typography.Title className="brand" level={3}>Skill<span>Vortex</span></Typography.Title>
          {state.catalog && state.projects && !state.editingSkillId && (
            <>
              <Input
                className="project-select"
                aria-label="Projeto ativo"
                readOnly
                value={activeProject ? `Projeto: ${activeProject.name}` : ''}
                placeholder="Nenhum projeto associado"
                title={activeProject?.sourcePath}
              />
              {activeProject && <Dropdown trigger={['click']} menu={{ items: [
                { key: 'folder', label: activeProject.sourcePath ? 'Alterar pasta' : 'Associar pasta',
                  icon: <ActionIcon action="folder" />, onClick: () => api.postMessage({ type: 'setProjectFolder' }) },
                { key: 'scan', label: 'Buscar skills no projeto', icon: <ActionIcon action="search" />,
                  disabled: !activeProject.sourcePath, onClick: () => api.postMessage({ type: 'scanProject' }) }
              ] }}>
                <ActionButton action="folder">Projeto</ActionButton>
              </Dropdown>}
            </>
          )}
          {!state.editingSkillId && (
            <Input
              className="search-input"
              aria-label="Buscar skills"
              prefix={<ActionIcon action="search" />}
              placeholder="Buscar skills, tags, agentes..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          )}
          {!state.editingSkillId && <div className="toolbar-spacer" />}
          {!state.editingSkillId && (
            <Space wrap size={12}>
              <ActionButton action="import" className="import-markdown-button" onClick={() => api.postMessage({ type: 'importMarkdown' })} disabled={!state.root}>Importar .md</ActionButton>
              <Dropdown trigger={['click']} disabled={!state.root} menu={{ items: [
                { key: 'card', label: <div className="menu-description"><span>Novo card</span><small>Organize uma ou varias skills em um conjunto</small></div>,
                  icon: <ActionIcon action="add" />, onClick: () => editCollection() },
                { key: 'skill', label: <div className="menu-description"><span>Nova Skill</span><small>Crie uma regra com seu proprio Markdown</small></div>,
                  icon: <ActionIcon action="edit" />, onClick: () => api.postMessage({ type: 'createSkill' }) }
              ] }}>
                <ActionButton action="add" className="new-skill-button" type="primary" disabled={!state.root}>Novo</ActionButton>
              </Dropdown>
            </Space>
          )}
        </header>

        {!state.root && (
          <section className="welcome">
            <Card className="welcome-hero">
              <Typography.Text className="welcome-eyebrow">BIBLIOTECA LOCAL DE MARKDOWN</Typography.Text>
              <Typography.Title level={1}>Suas skills de IA, organizadas.</Typography.Title>
              <Typography.Paragraph type="secondary">
                Crie uma biblioteca de skills para catalogar, editar e acompanhar a governanca das suas instrucoes Markdown.
                Seus arquivos permanecem locais; nada e enviado automaticamente aos agentes.
              </Typography.Paragraph>
              <Space wrap className="welcome-actions">
                <ActionButton action="add" type="primary" size="large" onClick={() => api.postMessage({ type: 'createVault' })}>
                  Criar biblioteca
                </ActionButton>
                <ActionButton action="library" size="large" onClick={() => api.postMessage({ type: 'openVault' })}>Abrir biblioteca</ActionButton>
                <ActionButton action="import" size="large" onClick={() => api.postMessage({ type: 'migrateDesktop' })}>Importar do desktop</ActionButton>
              </Space>
            </Card>
            <section className="feature-grid" aria-label="Funcionalidades">
              <Card><Typography.Title level={5}>Biblioteca e projetos</Typography.Title><Typography.Text type="secondary">Busque, filtre e vincule skills Markdown a projetos locais.</Typography.Text></Card>
              <Card><Typography.Title level={5}>Editor de texto e Markdown</Typography.Title><Typography.Text type="secondary">Edite nos dois paineis sincronizados, com barra de formatacao e cabecalho YAML protegido.</Typography.Text></Card>
              <Card><Typography.Title level={5}>Governanca e backup</Typography.Title><Typography.Text type="secondary">Controle skills liberadas ou bloqueadas e restaure backups da biblioteca.</Typography.Text></Card>
            </section>
            <section className="screen-previews">
              <div className="screen-previews-heading">
                <Typography.Title level={3}>Conheca as telas</Typography.Title>
                <Typography.Text type="secondary">Capturas completas da extensao SkillVortex com dados de exemplo.</Typography.Text>
              </div>
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card className="screen-preview-card" cover={<img src={dashboardPreview} alt="Captura completa do dashboard atual da extensao SkillVortex" />}>
                    <Typography.Title level={5}>Dashboard · Biblioteca de Skills</Typography.Title>
                    <Typography.Text type="secondary">Busca, filtros, categorias, estados de governanca e vinculos por projeto.</Typography.Text>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card className="screen-preview-card" cover={<img src={editorPreview} alt="Captura completa do editor atual com Markdown e Texto lado a lado" />}>
                    <Typography.Title level={5}>Editor · Texto e Markdown</Typography.Title>
                    <Typography.Text type="secondary">Paineis editaveis sincronizados, icones de formatacao, YAML protegido, projetos e governanca.</Typography.Text>
                  </Card>
                </Col>
              </Row>
            </section>
          </section>
        )}

        {error && <Alert className="feedback" type="error" showIcon message={error} closable onClose={() => setError('')} />}
        {notice && <Alert className="feedback" type="success" showIcon message={notice} closable onClose={() => setNotice('')} />}
        {Boolean(state.externalChanges?.length) && <Alert className="feedback" type="warning" showIcon
          message={`Alteracoes externas detectadas em ${state.externalChanges?.length} skill(s)`}
          description="Compare as versoes antes de importar ou restaurar. Nenhum arquivo sera substituido automaticamente."
          action={<Button disabled={dirty || saving} title={dirty ? 'Preserve seu rascunho antes de revisar as versoes.' : 'Comparar, importar ou restaurar com backup'}
            onClick={() => api.postMessage({ type: 'reviewExternalChanges' })}>Revisar alteracoes</Button>} />}

        {state.root && state.catalog && state.projects && !state.editingSkillId && (
          <>
            <div className="vault-path">
              <Typography.Text type="secondary" title={`Pasta da biblioteca: ${state.root}`}>Pasta da biblioteca: {state.root}</Typography.Text>
              <ActionButton action="refresh" className="sync-library-button" size="small"
                title="Verificar arquivos e escolher qual versao sincronizar entre projeto e biblioteca, com backup."
                onClick={() => api.postMessage({ type: 'reviewExternalChanges' })}>Sincronizar</ActionButton>
              <Dropdown trigger={['click']} menu={{ items: [
                { key: 'refresh', label: 'Atualizar', icon: <ActionIcon action="refresh" />, onClick: () => api.postMessage({ type: 'refresh' }) },
                { key: 'backup', label: <span className="vault-menu-backup">Criar backup</span>, icon: <ActionIcon action="backup" />, onClick: () => api.postMessage({ type: 'createBackup' }) },
                { key: 'restore', label: <span className="vault-menu-restore">Restaurar backup</span>, icon: <ActionIcon action="restore" />, onClick: () => api.postMessage({ type: 'restoreBackup' }) },
                { type: 'divider' },
                { key: 'open', label: 'Abrir outra biblioteca', icon: <ActionIcon action="library" />, onClick: () => api.postMessage({ type: 'openVault' }) },
                { key: 'desktop', label: 'Importar desktop', icon: <ActionIcon action="import" />, onClick: () => api.postMessage({ type: 'migrateDesktop' }) }
              ] }}>
                <ActionButton action="library" size="small" title="Gerenciar a biblioteca de skills">Biblioteca</ActionButton>
              </Dropdown>
            </div>
            <section className="library-heading">
              <div>
                <Space>
                  <Typography.Title level={2}>Gerenciador de Skills</Typography.Title>
                  <HelpTip label="Sobre o gerenciador">
                    Gerencie as skills disponiveis para os agentes do projeto.
                    {activeProject ? ` Projeto ativo: ${activeProject.name}.` : ' Ative Usar no Projeto para associar uma pasta.'}
                    O switch controla somente os agentes exibidos no card, com o mesmo Markdown da biblioteca.
                    Publicacoes antigas permanecem no local original ate desativar e reativar.
                    {activeProject?.sourcePath && ` Pasta: ${activeProject.sourcePath}`}
                  </HelpTip>
                </Space>
              </div>
              <Space wrap>
                <Tag>{cardCount} {cardCount === 1 ? 'card' : 'cards'}</Tag>
                <ActionButton action={showArchived ? 'back' : 'archive'} aria-pressed={showArchived}
                  onClick={() => {
                    setShowArchived(current => !current)
                    setSearch('')
                    setStatusFilter('all')
                    setCategoryFilter(undefined)
                    setAgentFilter(undefined)
                    setCollectionFilter(undefined)
                  }}>{showArchived ? 'Voltar para cards' : 'Arquivados'}</ActionButton>
                {allCards.length === 0 && <ActionButton action="examples" type="primary" title="Criar quatro cards de exemplo na biblioteca" onClick={() => modal.confirm({
                  title: 'Carregar exemplos do dashboard?',
                  content: 'Cria quatro cards com 1, 4, 2 e 0 skills, usando somente as categorias cadastradas.',
                  okText: 'Carregar exemplos',
                  cancelText: 'Cancelar',
                  okButtonProps: { className: 'action-button action-examples', icon: <ActionIcon action="examples" /> },
                  cancelButtonProps: { className: 'action-button action-back', icon: <ActionIcon action="back" /> },
                  onOk: () => api.postMessage({ type: 'createDocumentedExamples' })
                })}>
                  Carregar exemplos
                </ActionButton>}
              </Space>
            </section>

            <section className="filters">
              <Space wrap>
                <Select allowClear showSearch className="filter-select"
                  aria-label="Visualizar por agente" placeholder="Todos os agentes"
                  value={agentFilter} options={agentLabels.map(value => ({ value, label: value }))}
                  onChange={setAgentFilter} />
                <HelpTip label="Visualizacao por agente">
                  Filtra pelas labels declaradas no card. O switch controla somente os agentes exibidos.
                  O Markdown original continua unico na biblioteca.
                  Cards sem labels aparecem em Todos os agentes.
                </HelpTip>
                <Select aria-label="Filtrar por status" className="filter-select" value={statusFilter}
                  options={[{ value: 'all', label: 'Todos os status' },
                    ...statusNames.map(value => ({ value, label: labels[value] }))]} onChange={setStatusFilter} />
                <Select
                  allowClear
                  className="filter-select"
                  aria-label="Filtrar por categoria"
                  placeholder="Todas as categorias"
                  value={categoryFilter}
                  options={(state.catalog?.categories ?? []).map(category => ({ value: category, label: category }))}
                  onChange={setCategoryFilter}
                />
                <Select
                  allowClear className="filter-select collection-filter" aria-label="Filtrar por colecao"
                  placeholder="Todos os conjuntos" value={collectionFilter}
                  options={allCards.map(item => ({
                    value: item.id, label: `${item.name} (${item.skillIds.length})`
                  }))}
                  onChange={setCollectionFilter}
                />
                <ActionButton action="filter" onClick={() => setCategoryManagerOpen(true)}>Categorias</ActionButton>
                <HelpTip label="Como funcionam os conjuntos">
                  Cada card pode conter nenhuma, uma ou varias skills. O switch aplica a acao ao conjunto no projeto.
                  Skills compartilhadas com outros conjuntos tem a mesma ativacao.
                </HelpTip>
              </Space>
            </section>
            <Modal title="Categorias" open={categoryManagerOpen} footer={null} onCancel={() => setCategoryManagerOpen(false)}>
              <Space direction="vertical" className="full-width">
                <Space.Compact className="full-width">
                  <Input aria-label="Nome da nova categoria" placeholder="Nova categoria" maxLength={60}
                    value={categoryName} onChange={event => setCategoryName(event.target.value)} />
                  <ActionButton action="add" disabled={!categoryName.trim()} onClick={() => {
                    api.postMessage({ type: 'createCategory', name: categoryName }); setCategoryName('')
                  }}>Criar categoria</ActionButton>
                </Space.Compact>
                {state.catalog.categories.map(category => <div key={category} className="category-row">
                  <Typography.Text>{category}</Typography.Text>
                  <Tooltip title="Excluir categoria" destroyOnHidden>
                    <ActionButton action="delete" size="small" aria-label={`Excluir categoria ${category}`}
                      onClick={() => deleteCategory(category)} />
                  </Tooltip>
                </div>)}
              </Space>
            </Modal>
            <Modal title={collectionId ? 'Editar card' : 'Novo card'} open={collectionEditorOpen} width={920}
              className="card-editor-modal"
              okText="Salvar" cancelText="Cancelar"
              okButtonProps={{ disabled: !collectionName.trim() || !collectionCategory || !collectionDescription.trim() ||
                !collectionTags.length || !collectionAgents.some(agent => agent === 'GitHub Copilot' || agent === 'Antigravity'),
                className: 'action-button action-save', icon: <ActionIcon action="save" /> }}
              onCancel={() => setCollectionEditorOpen(false)} onOk={() => {
                api.postMessage({ type: 'saveCollection', id: collectionId, name: collectionName, skillIds: collectionSkillIds,
                  disabledSkillIds: collectionDisabledSkillIds.filter(id => collectionSkillIds.includes(id)),
                  category: collectionCategory, description: collectionDescription, tags: collectionTags,
                  agents: collectionAgents, status: collectionStatus, cardColor: collectionColor ?? null })
              }}>
              <div className="card-editor-layout">
              <div className="card-form">
                <Typography.Text className="form-full-line" type="secondary">Defina o conjunto e selecione suas skills. Os campos com * sao obrigatorios.</Typography.Text>
                {error && <Alert className="form-full-line" type="error" message={error} />}
                <div className="card-form-field">
                  <label htmlFor="card-name">Nome do conjunto *</label>
                  <Input id="card-name" aria-label="Nome da colecao" placeholder="Ex.: Qualidade do codigo" maxLength={60}
                    value={collectionName} onChange={event => setCollectionName(event.target.value)} />
                </div>
                <div className="card-form-field">
                  <label htmlFor="card-category">Categoria *</label>
                  <Select id="card-category" aria-label="Categoria do card" className="full-width" value={collectionCategory}
                    options={state.catalog.categories.map(value => ({ value, label: value }))} onChange={setCollectionCategory} />
                </div>
                <div className="card-form-field form-full-line">
                  <label htmlFor="card-description">Descricao *</label>
                  <Input.TextArea id="card-description" rows={3} aria-label="Descricao do card" value={collectionDescription} maxLength={1000}
                    placeholder="Descreva quando e para que usar este conjunto."
                    onChange={event => setCollectionDescription(event.target.value)} />
                </div>
                <div className="card-form-field form-full-line">
                  <label htmlFor="card-tags">Etiquetas *</label>
                  <Select id="card-tags" mode="tags" aria-label="Etiquetas do card" className="full-width"
                    placeholder="Digite uma etiqueta e pressione Enter" value={collectionTags}
                    onChange={values => setCollectionTags(values.map(value => value.trim()).filter(Boolean))} />
                </div>
                <div className="card-form-field">
                  <label htmlFor="card-agents">Agentes do card</label>
                  <Select id="card-agents" mode="tags" aria-label="Agentes do card" className="full-width" value={collectionAgents}
                    placeholder="Selecione os agentes"
                    options={['GitHub Copilot', 'Antigravity'].map(value => ({ value, label: value }))} onChange={setCollectionAgents} />
                </div>
                <div className="card-form-field">
                  <label htmlFor="card-status">Status *</label>
                  <Select id="card-status" aria-label="Status do card" className="full-width" value={collectionStatus}
                    options={statusNames.map(value => ({ value, label: labels[value] }))} onChange={setCollectionStatus} />
                </div>
                <div className="card-form-field">
                  <label htmlFor="card-color">Cor do card</label>
                  <Select id="card-color" aria-label="Cor do card" className="full-width" value={collectionColor ?? AUTOMATIC_COLOR}
                    options={cardColorOptions} onChange={value => setCollectionColor(isSkillCardColor(value) ? value : undefined)} />
                </div>
                <div className="card-form-field form-full-line">
                  <label htmlFor="card-skills">Skills do conjunto (opcional)</label>
                  <Select id="card-skills" mode="multiple" aria-label="Skills da colecao" placeholder="Busque e selecione uma ou mais skills"
                    className="full-width" value={collectionSkillIds} onChange={ids => {
                      setCollectionSkillIds(ids)
                      setCollectionDisabledSkillIds(previous => previous.filter(id => ids.includes(id)))
                    }}
                    options={state.catalog.skills.map(item => ({
                      value: item.id, label: item.name,
                      disabled: Boolean(state.catalog?.collections?.some(card =>
                        card.id !== collectionId && card.skillIds.includes(item.id)))
                    }))} />
                </div>
              </div>
                <aside className="card-skill-selector" aria-label="Selecao de skills do card">
                  <Typography.Title level={5}>Skills habilitadas</Typography.Title>
                  <Typography.Paragraph type="secondary">Ao ativar o card, somente as marcadas serao publicadas.</Typography.Paragraph>
                  {state.catalog.skills.filter(skill => collectionSkillIds.includes(skill.id)).map(skill =>
                    <Checkbox key={skill.id} checked={!collectionDisabledSkillIds.includes(skill.id)}
                      disabled={skill.status === 'blocked' && collectionDisabledSkillIds.includes(skill.id)}
                      onChange={event => setCollectionDisabledSkillIds(previous => event.target.checked
                        ? previous.filter(id => id !== skill.id) : [...previous, skill.id])}>
                      {skill.name}
                    </Checkbox>)}
                  {!collectionSkillIds.length && <Typography.Text type="secondary">Adicione skills ao conjunto.</Typography.Text>}
                </aside>
              </div>
            </Modal>
            <Modal title="Escolha a skill para usar no chat" open={Boolean(runningCard)}
              footer={null} onCancel={() => setRunningCard(null)}>
              <Space direction="vertical">
                {state.catalog.skills.filter(item => runningCard?.skillIds.includes(item.id)).map(item =>
                  <ActionButton key={item.id} action="run"
                    disabled={!activeProject || !isAgentLinked(activeProject, item.id, 'GitHub Copilot') || item.status === 'blocked'}
                    onClick={() => { api.postMessage({ type: 'runSkill', id: item.id, agent: 'GitHub Copilot' }); setRunningCard(null) }}>
                    {item.name}
                  </ActionButton>)}
              </Space>
            </Modal>
            {showArchived && <Typography.Title level={3}>Cards arquivados</Typography.Title>}
            <div className="skills-grid">
              {cards.map(item => {
                const members = state.catalog!.skills.filter(skill => item.skillIds.includes(skill.id))
                const selectedMembers = members.filter(skill => selectedSkillIds(item).includes(skill.id))
                const visibleAgents = agentFilter ? item.agents.filter(agent => agent === agentFilter) : item.agents
                const targets = visibleAgents.filter((agent): agent is SkillAgent =>
                  agent === 'GitHub Copilot' || agent === 'Antigravity')
                const linkedCount = members.filter(skill => targets.some(agent =>
                  activeProject && isAgentLinked(activeProject, skill.id, agent))).length
                const linked = members.length > 0 && targets.length > 0 && targets.every(agent =>
                  activeProject && (item.standaloneSkillId
                    ? isAgentLinked(activeProject, item.standaloneSkillId, agent) : isCollectionLinked(activeProject, item, agent)))
                const copilotLinked = targets.includes('GitHub Copilot') &&
                  members.some(skill => activeProject && isAgentLinked(activeProject, skill.id, 'GitHub Copilot'))
                const linkedAnywhere = Boolean(state.projects?.projects.some(project =>
                  item.skillIds.some(id => project.skillIds.includes(id)) ||
                  (!item.standaloneSkillId && project.collectionBindings?.some(binding => binding.collectionId === item.id))))
                const sharedActive = linkedAnywhere
                const lockedTitle = linkedAnywhere ? 'Desative as skills em todos os projetos antes de editar ou excluir.' : undefined
                const cardColor = item.cardColor ?? categoryColor(item.category)
                return (
                  <div key={item.id} className="skill-grid-item">
                    <Card className={`skill-card${linked ? ' skill-card-linked' : ''}`} style={{
                      borderTop: `3px solid ${cardColor}`,
                      ...(item.cardColor ? { backgroundImage: `linear-gradient(180deg, ${cardColor}33 0%, transparent 180px)` } : {})
                    }}>
                      <div className="skill-card-heading">
                        <Typography.Title level={5} title={item.name}>{item.name}</Typography.Title>
                        <Tag color={colors[item.status]}>{labels[item.status]}</Tag>
                        <ActionButton className="card-archive-button" action={item.archived ? 'restore' : 'archive'} size="small"
                          aria-label={item.archived ? 'Restaurar' : 'Arquivar'}
                          disabled={!item.archived && linkedAnywhere}
                          title={!item.archived && linkedAnywhere ? 'Desative em todos os projetos antes de arquivar.' : item.archived ? 'Restaurar' : 'Arquivar'}
                          onClick={() => api.postMessage({ type: 'archiveCard', kind: item.standaloneSkillId ? 'skill' : 'collection',
                            id: item.standaloneSkillId ?? item.id, archived: !item.archived })} />
                      </div>
                      <Tag color={cardColor} style={item.cardColor ? { color: skillCardTextColor(cardColor) } : undefined}>
                        {item.category}
                      </Tag>
                      <Space className="skill-tags" wrap size={[4, 4]}>
                        {item.tags.map(tag => <Tag key={tag}>#{tag}</Tag>)}
                      </Space>
                      <Typography.Paragraph className="skill-description" ellipsis={{ rows: 3 }}>
                        {item.description || 'Sem descricao.'}
                      </Typography.Paragraph>
                      <div className="skill-file">
                        <Typography.Text type="secondary">
                          {members.length} {members.length === 1 ? 'skill' : 'skills'}
                          {linkedCount > 0 && !linked ? ` (${linkedCount} ativa${linkedCount > 1 ? 's' : ''})` : ''}
                        </Typography.Text>
                        <div className="card-skill-list" tabIndex={members.length >= 3 ? 0 : undefined}
                          role="group" aria-label={`Skills do card ${item.name}`}>
                          {members.map(member => <div key={member.id} className="card-skill-row">
                            {!item.archived && !item.standaloneSkillId && <Checkbox
                              aria-label={`Habilitar ${member.name} no card ${item.name}`}
                              checked={!item.disabledSkillIds?.includes(member.id)}
                              disabled={!targets.length || ((item.status === 'blocked' || member.status === 'blocked') &&
                                Boolean(item.disabledSkillIds?.includes(member.id)))}
                              onChange={event => api.postMessage({ type: 'setCollectionSkillEnabled',
                                id: item.id, skillId: member.id, enabled: event.target.checked, agents: targets })} />}
                            <Button type="link" size="small"
                            disabled={Boolean(state.projects?.projects.some(project => project.skillIds.includes(member.id)))}
                            title="Editar Markdown desta skill"
                            onClick={() => api.postMessage({ type: 'openSkill', id: member.id })}>{member.name}</Button>
                          </div>)}
                          {!members.length && <Typography.Text type="secondary">Adicione uma skill ou selecione skills em Editar.</Typography.Text>}
                        </div>
                        <Space wrap size={[4, 4]}>
                          {visibleAgents.map(agent => <Tag key={agent} className="agent-label">{agent}</Tag>)}
                          <HelpTip label="Compatibilidade da skill">O switch controla os agentes exibidos: Copilot usa .github/skills; Antigravity usa .agents/skills. O Markdown original e unico.</HelpTip>
                        </Space>
                      </div>
                      <div className="skill-card-footer">
                        {!item.archived && <Space className="skill-card-project" size={4}>
                          <Switch
                            size="small"
                            aria-label={`Usar ${item.name} no projeto`}
                            title={item.status === 'blocked'
                              ? 'Edite o status da skill para permitir seu uso no projeto.'
                              : !targets.length ? 'Selecione GitHub Copilot ou Antigravity ao editar o card.'
                                : `${linked ? 'Desativar' : 'Ativar'} somente: ${targets.join(', ')}. O conteudo Markdown e o mesmo.`}
                            checked={linked}
                            disabled={(!linked && !linkedCount && (item.status === 'blocked' ||
                              selectedMembers.some(member => member.status === 'blocked'))) || !members.length || !targets.length}
                            onChange={() => api.postMessage(item.standaloneSkillId
                              ? { type: 'toggleProjectSkill', id: item.standaloneSkillId, agents: targets }
                              : { type: 'toggleCollection', id: item.id, enabled: !linked, agents: targets })}
                          />
                          <Typography.Text type="secondary">Usar no Projeto</Typography.Text>
                        </Space>}
                        <div className="skill-card-actions">
                          <ActionButton action="run"
                            aria-label="Usar no chat"
                            size="small"
                            disabled={item.archived || !copilotLinked || item.status === 'blocked'}
                            title={copilotLinked
                              ? members.length === 1
                                ? 'Abre o Copilot com esta skill selecionada. Descreva a tarefa e envie.'
                                : 'Escolha uma skill deste conjunto para usar no chat do Copilot.'
                              : 'Disponivel para GitHub Copilot. Exiba e ative esse agente para usar no chat.'}
                            onClick={() => members.length === 1
                              ? api.postMessage({ type: 'runSkill', id: members[0].id, agent: 'GitHub Copilot' }) : setRunningCard(item)}
                          >Usar no chat</ActionButton>
                          <ActionButton action="edit" aria-label="Editar" size="small" disabled={sharedActive}
                            title={sharedActive ? 'Desative em todos os projetos antes de editar a skill.' : 'Editar a skill compartilhada entre os agentes.'}
                            onClick={() => item.standaloneSkillId
                              ? api.postMessage({ type: 'openSkill', id: item.standaloneSkillId }) : editCollection(item)}>Editar</ActionButton>
                          {!item.standaloneSkillId && <ActionButton action="add"
                            aria-label="Adicionar skill"
                            size="small"
                            disabled={sharedActive}
                            title={sharedActive ? lockedTitle : 'Criar uma skill neste card'}
                            onClick={() => api.postMessage({ type: 'createSkill', collectionId: item.id, cardColor: null })}
                          >Adicionar skill</ActionButton>}
                          <ActionButton action="delete" aria-label="Excluir" size="small" danger disabled={linkedAnywhere}
                            title={lockedTitle ?? 'Excluir card'} onClick={() => {
                              if (item.standaloneSkillId) {
                                api.postMessage({ type: 'deleteSkill', id: item.standaloneSkillId })
                              } else api.postMessage({ type: 'deleteCollection', id: item.id })
                            }}>Excluir</ActionButton>
                        </div>
                      </div>
                    </Card>
                  </div>
                )
              })}
            </div>
            {!cards.length && (
              <Empty className="empty-library" description={
                allCards.length ? 'Nenhum card corresponde aos filtros.' : 'Sua biblioteca esta vazia. Crie um card, carregue os exemplos ou importe um Markdown.'
              }>
                {!allCards.length && <Space wrap>
                  <ActionButton action="add" type="primary" onClick={() => editCollection()}>Criar primeiro card</ActionButton>
                  <ActionButton action="examples" onClick={() => modal.confirm({
                    title: 'Carregar exemplos?', content: 'Cria quatro cards e sete skills de exemplo.',
                    okText: 'Carregar exemplos', cancelText: 'Cancelar',
                    okButtonProps: { className: 'action-button action-examples', icon: <ActionIcon action="examples" /> },
                    cancelButtonProps: { className: 'action-button action-back', icon: <ActionIcon action="back" /> },
                    onOk: () => api.postMessage({ type: 'createDocumentedExamples' })
                  })}>Carregar exemplos</ActionButton>
                  <ActionButton action="import" onClick={() => api.postMessage({ type: 'importMarkdown' })}>Importar .md</ActionButton>
                </Space>}
                {allCards.length > 0 && <ActionButton action="filter" onClick={() => {
                  setSearch(''); setStatusFilter('all'); setCategoryFilter(undefined)
                  setAgentFilter(undefined); setCollectionFilter(undefined)
                }}>Limpar filtros</ActionButton>}
              </Empty>
            )}
          </>
        )}

        {state.root && state.editingSkillId && draft && (
          <section className="editor">
            <div className="editor-heading">
              <div>
                <Typography.Title level={3}>Editando: {draft.name}</Typography.Title>
                <Typography.Text type="secondary">{dirty ? 'Nao salvo' : 'Todas as alteracoes salvas'}</Typography.Text>
              </div>
              <Space className="editor-top-actions" size={12} wrap>
                <ActionButton action="save" type="primary" onClick={saveDraft} loading={saving} disabled={!dirty}>Salvar</ActionButton>
                <ActionButton action="back" className="dashboard-back-button" onClick={leaveEditor} disabled={saving}>Voltar ao Dashboard</ActionButton>
              </Space>
            </div>
            <Card className="metadata-card">
              <div className="metadata-heading"><Typography.Text strong>Detalhes da skill</Typography.Text>
                <HelpTip label="Campos obrigatorios">Campos com * sao obrigatorios. Cor automatica e projetos sao opcionais.</HelpTip>
              </div>
              <Row gutter={[20, 20]}>
                <Col xs={24} md={12} xl={8}>
                  <label htmlFor="skill-name">Titulo *</label>
                  <Input id="skill-name" required value={draft.name} maxLength={100} disabled={saving} onChange={event => updateDraft('name', event.target.value)} />
                </Col>
                <Col xs={24} md={12} xl={8}>
                  <label htmlFor="skill-category">Categoria *</label>
                  <Select
                    id="skill-category"
                    aria-required="true"
                    className="full-width"
                    value={draft.category}
                    disabled={saving}
                    options={(state.catalog?.categories ?? []).map(category => ({ value: category, label: category }))}
                    onChange={value => updateDraft('category', value)}
                  />
                </Col>
                <Col xs={24} md={12} xl={8}>
                  <label htmlFor="skill-tags">Etiquetas *</label>
                  <Input id="skill-tags" required placeholder="Ex.: testes, qualidade (separe por virgulas)" value={draft.tags.join(', ')} disabled={saving} onChange={event =>
                    updateDraft('tags', event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))
                  } />
                </Col>
                <Col xs={24} md={12} xl={8}>
                  <label htmlFor="skill-status">Status *</label>
                  <Select
                    id="skill-status"
                    aria-required="true"
                    className="full-width"
                    value={draft.status}
                    disabled={saving}
                    options={statusNames.map(status => ({ value: status, label: labels[status] }))}
                    onChange={value => updateDraft('status', value as Status)}
                  />
                </Col>
                <Col xs={24} md={12} xl={16}>
                  <label htmlFor="skill-agents">Agentes do card</label>
                  <Select
                    id="skill-agents"
                    className="full-width"
                    mode="tags"
                    value={draft.agents}
                    disabled={saving}
                    options={['GitHub Copilot', 'Antigravity', ...draft.agents]
                      .filter((agent, index, agents) => agents.indexOf(agent) === index)
                      .map(agent => ({ value: agent, label: agent }))}
                    onChange={value => updateDraft('agents', value)}
                  />
                </Col>
                <Col span={24}>
                  <label htmlFor="skill-description">Descricao *</label>
                  <Input.TextArea id="skill-description" rows={2} maxLength={1000} required value={draft.description} disabled={saving}
                    onChange={event => updateDraft('description', event.target.value)} />
                </Col>
                <Col xs={24} md={12} xl={8}>
                  <label htmlFor="skill-card-color">Cor do card</label>
                  <Select
                    id="skill-card-color"
                    className="full-width"
                    value={draft.cardColor ?? AUTOMATIC_COLOR}
                    disabled={saving}
                    virtual={false}
                    options={cardColorOptions}
                    onChange={value => {
                      if (value === AUTOMATIC_COLOR) updateDraft('cardColor', undefined)
                      else if (isSkillCardColor(value)) updateDraft('cardColor', value)
                      else setError('Cor do card invalida.')
                    }}
                  />
                </Col>
                <Col xs={24} md={12} xl={16}>
                  <label>Caminho do arquivo</label>
                  <Input readOnly value={`${state.root}/${draft.filePath}`} />
                </Col>
              </Row>
            </Card>
            <Card className="editor-settings">
              <Tabs items={[
                {
                  key: 'projects', label: `Projetos (${draft.projectIds.length})`,
                  children: <div className="project-checklist">
                    {state.projects?.projects.length ? (
                      <Checkbox.Group
                        value={draft.projectIds}
                        disabled={saving || draft.status === 'blocked'}
                        onChange={value => updateDraft('projectIds', value as string[])}
                      >
                        <Space direction="vertical">
                          {state.projects.projects.map(project => (
                            <Checkbox key={project.id} value={project.id} disabled={!project.sourcePath && !draft.projectIds.includes(project.id)}>
                              {project.name}{project.sourcePath ? ` · ${project.sourcePath}` : ' · sem pasta associada'}
                            </Checkbox>
                          ))}
                        </Space>
                      </Checkbox.Group>
                    ) : <Empty description="Ative Usar no Projeto no Dashboard para associar uma pasta." />}
                  </div>
                },
                {
                  key: 'governance', label: 'Governanca',
                  children: <div className="governance-panel">
                    <Tag color={colors[draft.status]}>{labels[draft.status]}</Tag>
                    <Typography.Paragraph>
                      {draft.status === 'allowed' && 'A skill pode ser ativada no projeto. Liberada nao significa revisao ou teste de qualidade; o switch indica se esta ativa.'}
                      {draft.status === 'blocked' && 'Skills bloqueadas nao podem ser vinculadas. Ao salvar o bloqueio, os vinculos existentes serao removidos.'}
                    </Typography.Paragraph>
                    <Alert type="warning" showIcon message="Desativar remove o SKILL.md da descoberta automatica do Copilot e preserva o arquivo na biblioteca. Nao remove instrucoes ja carregadas numa conversa nem impede leitura explicita do arquivo." />
                  </div>
                }
              ]} />
            </Card>
            <Card className="markdown-editor-card" title="Conteudo da skill *"
              extra={<Typography.Text type="secondary">Barra aplicada a: {editorMode === 'text' ? 'Texto' : 'Markdown'}</Typography.Text>}>
              <div ref={setEditorToolbar} className="shared-editor-toolbar" />
              <div className="dual-editor-workspace">
                <section className={`editor-pane${editorMode === 'markdown' ? ' editor-pane-active' : ''}`} aria-label="Editor Markdown">
                  <Button type="text" className="editor-pane-heading" onClick={() => setEditorMode('markdown')}>Markdown</Button>
                  <Suspense fallback={<div className="editor-loading">Carregando Markdown...</div>}>
                    <MonacoMarkdownEditor key={draft.id} value={draft.content} readOnly={saving}
                      toolbar={editorToolbar} active={editorMode === 'markdown'} onFocus={() => setEditorMode('markdown')}
                      onChange={value => updateDraft('content', value)} />
                  </Suspense>
                </section>
                <section className={`editor-pane${editorMode === 'text' ? ' editor-pane-active' : ''}`} aria-label="Editor Texto">
                  <Button type="text" className="editor-pane-heading" onClick={() => setEditorMode('text')}>Texto</Button>
                  <Suspense fallback={<div className="editor-loading">Carregando texto...</div>}>
                    <VisualMarkdownEditor key={draft.id} value={draft.content} readOnly={saving}
                      toolbar={editorToolbar} active={editorMode === 'text'} onFocus={() => setEditorMode('text')}
                      onChange={value => updateDraft('content', value)} />
                  </Suspense>
                </section>
              </div>
            </Card>
          </section>
        )}
        </>}
      </main>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
