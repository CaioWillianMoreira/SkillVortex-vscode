import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Alert, Button, Card, Checkbox, Col, ConfigProvider, Empty, Input, Modal, Row,
  Select, Space, Switch, Tabs, Tag, Typography, theme
} from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Catalog, Projects, Skill } from '../src/model'
import {
  categoryColor, isSkillCardColor, SKILL_CARD_COLOR_LABELS, SKILL_CARD_COLORS, skillCardTextColor
} from '../src/skill-colors'
import dashboardPreview from './assets/dashboard-preview.png'
import editorPreview from './assets/editor-preview.png'
import './styles.css'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()
const MonacoMarkdownEditor = lazy(() => import('./MonacoMarkdownEditor'))
const labels = { validated: 'Validada', pending: 'Pendente', blocked: 'Bloqueada' }
const colors = { validated: 'green', pending: 'gold', blocked: 'red' }
const statusNames = ['validated', 'pending', 'blocked'] as const
type Status = typeof statusNames[number]
type AppState = {
  root: string | null
  catalog: Catalog | null
  projects: Projects | null
  editingSkillId: string | null
  content: string
  saved?: boolean
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
  const [modal, modalContext] = Modal.useModal()
  const [state, setState] = useState<AppState>(emptyState)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>()
  const [agentFilter, setAgentFilter] = useState<string>()
  const [projectName, setProjectName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
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
      if (event.data.saved) {
        setNotice('Alteracoes salvas no cofre.')
        setSaving(false)
      }
    }
    document.getElementById('runtime-fallback')?.remove()
    window.addEventListener('message', handler)
    api.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', handler)
  }, [])

  const activeProject = state.projects?.projects.find(project => project.id === state.projects?.activeProject)
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

  const dirty = Boolean(draft && JSON.stringify(draft) !== baseline.current)
  const skills = useMemo(() => (state.catalog?.skills ?? []).filter(item => {
    const matchesText = [
      item.name, item.description, item.category, item.filePath, ...item.tags, ...item.agents
    ].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())
    return matchesText &&
      (statusFilter === 'all' || item.status === statusFilter) &&
      (!categoryFilter || item.category === categoryFilter) &&
      (!agentFilter || item.agents.includes(agentFilter))
  }), [state.catalog, search, statusFilter, categoryFilter, agentFilter])

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
      okButtonProps: { danger: true },
      onOk: () => api.postMessage({ type: 'backToDashboard' })
    })
  }
  const saveDraft = () => {
    if (!draft || !dirty || saving) return
    if (!draft.description.trim()) {
      setError('Informe a descricao da skill antes de salvar.')
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        saveDraft()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })

  return (
    <ConfigProvider theme={{
      algorithm: theme.darkAlgorithm,
      token: { colorPrimary: '#ff4d4f', colorBgContainer: '#171717', borderRadius: 8 }
    }}>
      {modalContext}
      <main>
        <header className="topbar">
          <Typography.Title className="brand" level={3}>Skill<span>Vortex</span></Typography.Title>
          {state.catalog && state.projects && !state.editingSkillId && (
            <>
              <Select
                className="project-select"
                aria-label="Projeto ativo"
                value={state.projects.activeProject ?? undefined}
                placeholder="Selecione um projeto"
                options={state.projects.projects.map(project => ({ value: project.id, label: `Projeto: ${project.name}` }))}
                onChange={id => api.postMessage({ type: 'setActiveProject', id })}
              />
              {activeProject && (
                <Space wrap>
                  <Button onClick={() => api.postMessage({ type: 'setProjectFolder' })}>
                    {activeProject.sourcePath ? 'Alterar pasta' : 'Associar pasta'}
                  </Button>
                  <Button
                    disabled={!activeProject.sourcePath}
                    onClick={() => api.postMessage({ type: 'scanProject' })}
                  >
                    Buscar skills no projeto
                  </Button>
                </Space>
              )}
            </>
          )}
          {!state.editingSkillId && (
            <Input
              className="search-input"
              aria-label="Buscar skills"
              placeholder="⌕ Buscar skills, tags, agentes..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          )}
          {!state.editingSkillId && <div className="toolbar-spacer" />}
          {state.editingSkillId && draft ? (
            <Space className="editor-top-actions" wrap>
              <Button onClick={leaveEditor} disabled={saving}>Voltar ao Dashboard</Button>
              <Button type="primary" onClick={saveDraft} loading={saving} disabled={!dirty}>Salvar</Button>
            </Space>
          ) : (
            <Space wrap>
              <Button onClick={() => api.postMessage({ type: 'importMarkdown' })} disabled={!state.root}>Importar .md</Button>
              <Input
                className="inline-create-input"
                aria-label="Nome do novo projeto"
                placeholder="Novo Projeto"
                value={projectName}
                onChange={event => setProjectName(event.target.value)}
                onPressEnter={() => {
                  if (projectName.trim()) api.postMessage({ type: 'createProject', name: projectName })
                  setProjectName('')
                }}
              />
              <Button onClick={() => {
                if (projectName.trim()) api.postMessage({ type: 'createProject', name: projectName })
                setProjectName('')
              }} disabled={!state.root || !projectName.trim()}>Criar projeto</Button>
              <Button type="primary" onClick={() => api.postMessage({ type: 'createSkill' })} disabled={!state.root}>Nova Skill</Button>
            </Space>
          )}
        </header>

        {!state.root && (
          <section className="welcome">
            <Card className="welcome-hero">
              <Typography.Text className="welcome-eyebrow">BIBLIOTECA LOCAL DE MARKDOWN</Typography.Text>
              <Typography.Title level={1}>Suas skills de IA, organizadas.</Typography.Title>
              <Typography.Paragraph type="secondary">
                Crie um cofre para catalogar, editar e acompanhar a governanca das suas instrucoes Markdown.
                Seus arquivos permanecem locais; nada e enviado automaticamente aos agentes.
              </Typography.Paragraph>
              <Space wrap className="welcome-actions">
                <Button type="primary" size="large" onClick={() => api.postMessage({ type: 'createVault' })}>
                  Criar cofre
                </Button>
                <Button size="large" onClick={() => api.postMessage({ type: 'openVault' })}>Abrir cofre</Button>
                <Button size="large" onClick={() => api.postMessage({ type: 'migrateDesktop' })}>Importar do desktop</Button>
              </Space>
            </Card>
            <section className="feature-grid" aria-label="Funcionalidades">
              <Card><Typography.Title level={5}>Biblioteca e projetos</Typography.Title><Typography.Text type="secondary">Busque, filtre e vincule skills Markdown a projetos locais.</Typography.Text></Card>
              <Card><Typography.Title level={5}>Editor e visualizacao</Typography.Title><Typography.Text type="secondary">Edite com Monaco e confira a previa Markdown com suporte GFM.</Typography.Text></Card>
              <Card><Typography.Title level={5}>Governanca e backup</Typography.Title><Typography.Text type="secondary">Organize estados de revisao e restaure backups do cofre.</Typography.Text></Card>
            </section>
            <section className="screen-previews">
              <div className="screen-previews-heading">
                <Typography.Title level={3}>Conheca as telas</Typography.Title>
                <Typography.Text type="secondary">Referencias visuais do aplicativo desktop SkillVortex.</Typography.Text>
              </div>
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card className="screen-preview-card" cover={<img src={dashboardPreview} alt="Captura de referencia do dashboard e biblioteca de skills do SkillVortex desktop" />}>
                    <Typography.Title level={5}>Dashboard · Biblioteca de Skills</Typography.Title>
                    <Typography.Text type="secondary">Busca, filtros, categorias, estados de governanca e vinculos por projeto.</Typography.Text>
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card className="screen-preview-card" cover={<img src={editorPreview} alt="Captura de referencia do editor Markdown e governanca do SkillVortex desktop" />}>
                    <Typography.Title level={5}>Editor · Markdown e governanca</Typography.Title>
                    <Typography.Text type="secondary">Metadados, editor Markdown, visualizacao, projetos vinculados e revisao.</Typography.Text>
                  </Card>
                </Col>
              </Row>
            </section>
          </section>
        )}

        {error && <Alert className="feedback" type="error" showIcon message={error} closable onClose={() => setError('')} />}
        {notice && <Alert className="feedback" type="success" showIcon message={notice} closable onClose={() => setNotice('')} />}

        {state.root && state.catalog && state.projects && !state.editingSkillId && (
          <>
            <div className="vault-path">
              <Typography.Text type="secondary" title={state.root}>{state.root}</Typography.Text>
              <Button size="small" onClick={() => api.postMessage({ type: 'refresh' })}>Atualizar</Button>
              <Button size="small" onClick={() => api.postMessage({ type: 'createBackup' })}>Criar backup</Button>
              <Button size="small" onClick={() => api.postMessage({ type: 'restoreBackup' })}>Restaurar backup</Button>
              <Button size="small" onClick={() => api.postMessage({ type: 'openVault' })}>Abrir outro cofre</Button>
              <Button size="small" onClick={() => api.postMessage({ type: 'migrateDesktop' })}>Importar desktop</Button>
            </div>
            <section className="library-heading">
              <div>
                <Typography.Title level={2}>Biblioteca de Skills</Typography.Title>
                <Typography.Text type="secondary">
                  Gerencie as skills disponiveis para os agentes do projeto.
                  {activeProject ? ` Projeto ativo: ${activeProject.name}.` : ' Ative Usar no Projeto para associar a pasta aberta ou escolher um projeto.'}
                </Typography.Text>
                {activeProject?.sourcePath && (
                  <Typography.Paragraph className="active-project-path" type="secondary" title={activeProject.sourcePath}>
                    Pasta do projeto: {activeProject.sourcePath}
                  </Typography.Paragraph>
                )}
              </div>
              <Space wrap>
                <Tag>{skills.length} {skills.length === 1 ? 'skill' : 'skills'}</Tag>
                <Button type="primary" title="Criar e atualizar os oito cards da documentação no cofre" onClick={() => modal.confirm({
                  title: 'Carregar exemplos do dashboard?',
                  content: 'Cria no cofre os cards da documentação que faltam e atualiza os metadados dos exemplos existentes. IDs, caminhos e conteúdo Markdown existentes serão preservados. Skills bloqueadas serão desvinculadas dos projetos.',
                  okText: 'Carregar exemplos',
                  cancelText: 'Cancelar',
                  onOk: () => api.postMessage({ type: 'createDocumentedExamples' })
                })}>
                  Carregar exemplos
                </Button>
              </Space>
            </section>

            <section className="filters">
              <Space wrap>
                <Button type={statusFilter === 'all' ? 'primary' : 'default'} onClick={() => setStatusFilter('all')}>Todas</Button>
                {statusNames.map(status => (
                  <Button key={status} type={statusFilter === status ? 'primary' : 'default'} onClick={() => setStatusFilter(status)}>
                    {labels[status]}
                  </Button>
                ))}
              </Space>
              <Space wrap>
                <Input
                  className="inline-create-input"
                  aria-label="Nome da nova categoria"
                  placeholder="Nova Categoria"
                  value={categoryName}
                  onChange={event => setCategoryName(event.target.value)}
                  onPressEnter={() => {
                    if (categoryName.trim()) api.postMessage({ type: 'createCategory', name: categoryName })
                    setCategoryName('')
                  }}
                />
                <Button onClick={() => {
                  if (categoryName.trim()) api.postMessage({ type: 'createCategory', name: categoryName })
                  setCategoryName('')
                }} disabled={!categoryName.trim()}>Criar categoria</Button>
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
                  allowClear
                  className="filter-select"
                  aria-label="Filtrar por agente"
                  placeholder="Todos os agentes"
                  value={agentFilter}
                  options={[...new Set((state.catalog?.skills ?? []).flatMap(item => item.agents))]
                    .map(agent => ({ value: agent, label: agent }))}
                  onChange={setAgentFilter}
                />
              </Space>
            </section>

            <Row gutter={[16, 16]}>
              {skills.map(item => {
                const linked = Boolean(activeProject?.skillIds.includes(item.id))
                const cardColor = item.cardColor ?? categoryColor(item.category)
                return (
                  <Col key={item.id} xs={24} sm={24} md={12} lg={8} xl={6}>
                    <Card className={`skill-card${linked ? ' skill-card-linked' : ''}`} style={{
                      borderTop: `3px solid ${cardColor}`,
                      ...(item.cardColor ? { backgroundImage: `linear-gradient(180deg, ${cardColor}33 0%, transparent 180px)` } : {})
                    }}>
                      <div className="skill-card-heading">
                        <Typography.Title level={5} title={item.name}>{item.name}</Typography.Title>
                        <Tag color={colors[item.status]}>{labels[item.status]}</Tag>
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
                        <Typography.Text type="secondary" title={item.originPath ?? item.filePath}>
                          ▱ {item.originPath ?? item.filePath}
                        </Typography.Text>
                        <Space wrap size={[4, 4]}>
                          {item.agents.map(agent => <Tag key={agent}>{agent}</Tag>)}
                        </Space>
                      </div>
                      <div className="skill-card-footer">
                        <Space className="skill-card-project">
                          <Switch
                            size="small"
                            aria-label={`Usar ${item.name} no projeto`}
                            title={item.status === 'blocked'
                              ? 'Edite o status da skill para permitir seu uso no projeto.'
                              : linked
                                ? 'Desativar e preservar o SKILL.md no cofre.'
                                : 'Criar .github/skills/<nome>/SKILL.md na pasta do projeto.'}
                            checked={linked}
                            disabled={item.status === 'blocked'}
                            onChange={() => api.postMessage({ type: 'toggleProjectSkill', id: item.id })}
                          />
                          <Typography.Text type="secondary">Usar no Projeto</Typography.Text>
                        </Space>
                        <Space className="skill-card-actions" size={4}>
                          <Button
                            size="small"
                            type="link"
                            disabled={!linked || item.status === 'blocked'}
                            title={linked
                              ? 'Abrir o chat do Copilot com esta skill; revise o pedido e envie.'
                              : 'Ative a skill no projeto para executa-la.'}
                            onClick={() => api.postMessage({ type: 'runSkill', id: item.id })}
                          >Executar</Button>
                          <Button size="small" type="link" onClick={() => api.postMessage({ type: 'openSkill', id: item.id })}>Editar</Button>
                          <Button size="small" type="link" onClick={() => api.postMessage({ type: 'unlinkSkill', id: item.id })}>Desvincular</Button>
                          <Button size="small" danger type="link" onClick={() => api.postMessage({ type: 'deleteSkill', id: item.id })}>Excluir</Button>
                        </Space>
                      </div>
                    </Card>
                  </Col>
                )
              })}
            </Row>
            {!skills.length && (
              <Empty className="empty-library" description={
                state.catalog.skills.length
                  ? 'Nenhuma skill corresponde aos filtros'
                  : 'Seu cofre ainda nao tem skills. Use Carregar exemplos para ver os oito cards da documentacao, Importar .md para adicionar seus arquivos ou Nova Skill para criar uma.'
              } />
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
              <Button type="primary" onClick={saveDraft} loading={saving} disabled={!dirty}>Salvar</Button>
            </div>
            <Card className="metadata-card">
              <Row gutter={[12, 12]}>
                <Col xs={24} md={12} xl={6}>
                  <label htmlFor="skill-name">Titulo</label>
                  <Input id="skill-name" value={draft.name} maxLength={100} disabled={saving} onChange={event => updateDraft('name', event.target.value)} />
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <label htmlFor="skill-category">Categoria</label>
                  <Select
                    id="skill-category"
                    className="full-width"
                    value={draft.category}
                    disabled={saving}
                    options={(state.catalog?.categories ?? []).map(category => ({ value: category, label: category }))}
                    onChange={value => updateDraft('category', value)}
                  />
                </Col>
                <Col xs={24} md={12} xl={6}>
                  <label htmlFor="skill-tags">Etiquetas (separadas por virgula)</label>
                  <Input id="skill-tags" value={draft.tags.join(', ')} disabled={saving} onChange={event =>
                    updateDraft('tags', event.target.value.split(',').map(tag => tag.trim()).filter(Boolean))
                  } />
                </Col>
                <Col xs={24} md={12} xl={3}>
                  <label htmlFor="skill-status">Status</label>
                  <Select
                    id="skill-status"
                    className="full-width"
                    value={draft.status}
                    disabled={saving}
                    options={statusNames.map(status => ({ value: status, label: labels[status] }))}
                    onChange={value => updateDraft('status', value as Status)}
                  />
                </Col>
                <Col xs={24} md={12} xl={3}>
                  <label htmlFor="skill-agents">Agentes</label>
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
                  <label htmlFor="skill-description">Descricao</label>
                  <Input.TextArea id="skill-description" rows={2} maxLength={1000} required value={draft.description} disabled={saving}
                    onChange={event => updateDraft('description', event.target.value)} />
                </Col>
                <Col xs={24} md={8} xl={6}>
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
                <Col xs={24} md={16} xl={18}>
                  <label>Caminho do arquivo</label>
                  <Input readOnly value={`${state.root}/${draft.filePath}`} />
                </Col>
              </Row>
            </Card>
            <Row className="editor-workspace" gutter={[16, 16]}>
              <Col xs={24} xl={12}>
                <Card className="markdown-editor-card" title="Conteudo Markdown">
                  <Suspense fallback={<div className="editor-loading">Carregando Monaco...</div>}>
                    <MonacoMarkdownEditor
                      value={draft.content}
                      readOnly={saving}
                      onChange={value => updateDraft('content', value)}
                    />
                  </Suspense>
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card className="editor-panel">
                  <Tabs
                    items={[
                      {
                        key: 'preview', label: 'Visualizacao',
                        children: <article className="markdown-preview">
                          <Typography.Title level={3}>{draft.name}</Typography.Title>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.content}</ReactMarkdown>
                        </article>
                      },
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
                          ) : <Empty description="Crie um projeto no Dashboard para vincular skills." />}
                        </div>
                      },
                      {
                        key: 'governance', label: 'Governanca',
                        children: <div className="governance-panel">
                          <Tag color={colors[draft.status]}>{labels[draft.status]}</Tag>
                          <Typography.Paragraph>
                            {draft.status === 'validated' && 'A skill pode ser vinculada a projetos. Validada nao significa aprovacao automatica de qualidade ou seguranca.'}
                            {draft.status === 'pending' && 'A skill aguarda revisao, mas pode ser vinculada a projetos.'}
                            {draft.status === 'blocked' && 'Skills bloqueadas nao podem ser vinculadas. Ao salvar o bloqueio, os vinculos existentes serao removidos.'}
                          </Typography.Paragraph>
                          <Alert type="warning" showIcon message="Desativar remove o SKILL.md da descoberta automatica do Copilot e preserva o arquivo no cofre. Nao remove instrucoes ja carregadas numa conversa nem impede leitura explicita do arquivo." />
                        </div>
                      }
                    ]}
                  />
                </Card>
              </Col>
            </Row>
          </section>
        )}
      </main>
    </ConfigProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
