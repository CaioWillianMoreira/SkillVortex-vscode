import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Button, Card, Col, ConfigProvider, Empty, Input, Row, Space, Tag, Typography, theme } from 'antd'
import type { Catalog, Projects } from '../src/model'
import './styles.css'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()
const labels = { validated: 'Validada', pending: 'Pendente', blocked: 'Bloqueada' }
const colors = { validated: 'green', pending: 'gold', blocked: 'red' }

function App(): React.JSX.Element {
  const [state, setState] = useState<{ root: string | null; catalog: Catalog | null; projects: Projects | null }>({
    root: null, catalog: null, projects: null
  })
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === 'state') { setState(event.data); setError('') }
      if (event.data.type === 'error') setError(event.data.message)
    }
    window.addEventListener('message', handler)
    api.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', handler)
  }, [])
  const skills = state.catalog?.skills.filter(skill =>
    [skill.name, skill.description, skill.category, ...skill.tags, ...skill.agents]
      .join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())
  ) ?? []
  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#ff4d4f', colorBgContainer: '#141414' } }}>
      <main>
        <header><Typography.Title>Skill<span>Vortex</span></Typography.Title><Tag>Base da extensao · Etapa 1</Tag></header>
        <Space wrap>
          <Button onClick={() => api.postMessage({ type: 'createVault' })}>Criar cofre</Button>
          <Button onClick={() => api.postMessage({ type: 'openVault' })}>Abrir cofre</Button>
          <Button type="primary" onClick={() => api.postMessage({ type: 'migrateDesktop' })}>Importar desktop</Button>
          <Button onClick={() => api.postMessage({ type: 'refresh' })}>Atualizar</Button>
        </Space>
        {error && <Alert type="error" showIcon message={error} />}
        <Typography.Paragraph type="secondary">{state.root ?? 'Selecione ou crie um cofre local.'}</Typography.Paragraph>
        <Input placeholder="Buscar skills, categorias, tags e agentes..." value={search} onChange={event => setSearch(event.target.value)} />
        <Typography.Title level={3}>Biblioteca · {skills.length} skills</Typography.Title>
        {state.catalog && <Typography.Paragraph type="secondary">{state.projects?.projects.length ?? 0} projetos preservados. Edite o Markdown no editor nativo do VS Code.</Typography.Paragraph>}
        <Row gutter={[16, 16]}>
          {skills.map(skill => <Col key={skill.id} xs={24} sm={12} lg={8} xl={6}>
            <Card title={skill.name} extra={<Tag color={colors[skill.status]}>{labels[skill.status]}</Tag>}>
              <Tag>{skill.category}</Tag>
              <Typography.Paragraph>{skill.description}</Typography.Paragraph>
              <Space wrap>{skill.tags.map(tag => <Tag key={tag}>#{tag}</Tag>)}</Space>
              <Typography.Paragraph type="secondary">{skill.filePath}</Typography.Paragraph>
              <Button onClick={() => api.postMessage({ type: 'openSkill', id: skill.id })}>Editar Markdown</Button>
            </Card>
          </Col>)}
        </Row>
        {!skills.length && <Empty description="Nenhuma skill para exibir" />}
      </main>
    </ConfigProvider>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
