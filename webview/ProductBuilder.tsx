import { useEffect, useRef, useState } from 'react'
import { Alert, Card, Checkbox, Empty, Input, Modal, Space, Tag, Typography } from 'antd'
import type { MindCardsState } from '../src/mindcards-model'
import type { BuilderSource } from '../src/product-builder-model'
import { buildFaithfulSkill } from '../src/product-builder-model'
import workerSource from 'virtual:builder-worker'
import { readW3cExcerpts } from './w3c-references'
import { ActionButton } from './Actions'

type Bridge = { postMessage(message: unknown): void }
export default function ProductBuilder({ root, api, onDirtyChange, onBusyChange, onOpenSkill, openSkillLabel = 'Revisar no SkillVortex' }: {
  root: string | null; api: Bridge; onDirtyChange(value: boolean): void; onBusyChange(value: boolean): void; onOpenSkill(): void
  openSkillLabel?: string
}): React.JSX.Element {
  const [modal, context] = Modal.useModal()
  const [state, setState] = useState<MindCardsState>()
  const [objective, setObjective] = useState('')
  const [title, setTitle] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [content, setContent] = useState('')
  const [suggestions, setSuggestions] = useState('')
  const [useW3c, setUseW3c] = useState(false)
  const [referenceNotice, setReferenceNotice] = useState('')
  const [sources, setSources] = useState<BuilderSource[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const worker = useRef<Worker | null>(null)
  const request = useRef<{ id: string; title: string; objective: string } | null>(null)
  const pending = useRef<'generate' | 'open' | null>(null)
  const consent = useRef(false)
  const resourceController = useRef<AbortController | null>(null)
  const runtimeModule = useRef<string | undefined>(undefined)
  const generationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirty = Boolean(objective || title || selected.length || content)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => {
    const fail = (message: string) => {
      setError(message)
      setProgress('')
      setBusy(false)
      pending.current = null
      worker.current?.terminate()
      worker.current = null
      resourceController.current?.abort()
      clearTimeout(generationTimer.current)
      if (runtimeModule.current) URL.revokeObjectURL(runtimeModule.current)
    }
    const receive = async (event: MessageEvent) => {
      const message = event.data
      if (message.type === 'builderProgress' && message.requestId === request.current?.id && pending.current === 'generate') setProgress(message.message)
      if (message.type === 'builderError' && message.requestId === request.current?.id && pending.current === 'generate') { fail(message.message); return }
      if (message.type === 'error' && pending.current) { fail(message.message); return }
      if (message.root !== root) return
      if (message.type === 'mindCards') {
        setState(message.state)
        setSelected(current => current.filter(id => message.state.notes.some((note: { id: string; archived?: boolean }) => note.id === id && !note.archived)))
      }
      if (message.type === 'builderSources' && pending.current === 'generate' && request.current && request.current.id === message.requestId) {
        const currentRequest = request.current
        try {
          const references = readW3cExcerpts(message.references ?? [])
          setContent(buildFaithfulSkill(currentRequest.title, currentRequest.objective, message.sources, references))
          setSources(message.sources)
          setSuggestions('')
          setReferenceNotice(message.referenceNotice || (references.length
            ? `${references.length} documento(s) W3C consultado(s). A IA recebe trechos de ate 1.200 caracteres por documento. Confira os links no rascunho.` : ''))
          resourceController.current = new AbortController()
          const signal = resourceController.current.signal
          generationTimer.current = setTimeout(() => fail('A IA local excedeu 8 minutos. Tente novamente com menos notas ou um objetivo menor.'), 480000)
          const readResource = async (url: string) => {
            const response = await fetch(url, { signal })
            if (!response.ok) throw new Error(`Nao foi possivel carregar o recurso local: HTTP ${response.status}.`)
            return response.arrayBuffer()
          }
          setProgress('Carregando arquivos locais para a IA...')
          const files = []
          for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'generation_config.json', 'onnx/model_quantized.onnx']) {
            files.push({ name, buffer: await readResource(`${message.modelPath}qwen/${name}`) })
          }
          const wasm = await readResource(`${message.runtimePath}ort-wasm-simd-threaded.jsep.wasm`)
          const module = await readResource(`${message.runtimePath}ort-wasm-simd-threaded.jsep.mjs`)
          signal.throwIfAborted()
          if (request.current?.id !== currentRequest.id || pending.current !== 'generate') return
          runtimeModule.current = URL.createObjectURL(new Blob([module], { type: 'text/javascript' }))
          const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
          worker.current = new Worker(workerUrl, { type: 'module' })
          URL.revokeObjectURL(workerUrl)
          worker.current.onmessage = ({ data }) => {
            if (request.current?.id !== currentRequest.id || pending.current !== 'generate') return
            if (data.type === 'progress') setProgress(data.message)
            if (data.type === 'error') fail(data.message)
            if (data.type === 'result') {
              setSuggestions(data.content)
              setProgress('Skill montada com os textos originais. Sugestoes da IA separadas para revisao; nao serao salvas automaticamente.')
              setBusy(false)
              pending.current = null
              worker.current?.terminate()
              worker.current = null
              clearTimeout(generationTimer.current)
              if (runtimeModule.current) URL.revokeObjectURL(runtimeModule.current)
            }
          }
          worker.current.onerror = event => {
            if (request.current?.id === currentRequest.id && pending.current === 'generate') fail(`Falha na IA local: ${event.message}`)
          }
          worker.current.onmessageerror = () => {
            if (request.current?.id === currentRequest.id && pending.current === 'generate') fail('Nao foi possivel receber a resposta da IA local.')
          }
          worker.current.postMessage({
            objective: currentRequest.objective, sources: message.sources, references,
            runtimeModule: runtimeModule.current, wasm, files
          }, [wasm, ...files.map(file => file.buffer)])
        } catch (error) {
          if (request.current?.id === currentRequest.id && pending.current === 'generate') fail(error instanceof Error ? error.message : String(error))
        }
      }
      if (message.type === 'builderSkillOpened' && pending.current === 'open') {
        setBusy(false)
        pending.current = null
        onOpenSkill()
      }
    }
    window.addEventListener('message', receive)
    if (root) api.postMessage({ type: 'loadMindCards' })
    return () => {
      window.removeEventListener('message', receive)
      worker.current?.terminate()
      worker.current = null
      resourceController.current?.abort()
      clearTimeout(generationTimer.current)
      pending.current = null
      request.current = null
      api.postMessage({ type: 'cancelBuilder' })
      if (runtimeModule.current) URL.revokeObjectURL(runtimeModule.current)
    }
  }, [root, api, onOpenSkill])

  const generate = async () => {
    if (busy || !state) return
    if (useW3c && !await modal.confirm({
      title: 'Consultar fontes oficiais do W3C?',
      content: 'A extensao seleciona ate 2 documentos conhecidos do W3C por palavras-chave dos cards e do objetivo, localmente. Apenas URLs fixas em www.w3.org serao acessadas; o texto das notas e o objetivo nao serao enviados. O W3C recebe os dados normais da conexao, como seu IP. Nao e busca livre nem uma fonte de regras de ranqueamento SEO.',
      okText: 'Consultar W3C', cancelText: 'Cancelar'
    })) return
    if (!consent.current) {
      const accepted = await modal.confirm({
        title: 'Usar IA local no Product Builder?',
        content: 'O primeiro uso baixa aproximadamente 500 MB do modelo Qwen2.5 0.5B do Hugging Face para o armazenamento local da extensao. O modelo usa CPU e memoria da sua maquina e pode levar minutos. As notas nao sao enviadas: a geracao acontece localmente.',
        okText: 'Continuar e baixar', cancelText: 'Cancelar'
      })
      if (!accepted) return
      consent.current = true
    }
    if (content && !await modal.confirm({ title: 'Substituir o rascunho atual?', content: 'Copie ou revise o texto antes de gerar novamente.',
      okText: 'Gerar novamente', cancelText: 'Cancelar' })) return
    setError('')
    setBusy(true)
    setProgress('Lendo notas selecionadas...')
    pending.current = 'generate'
    request.current = { id: crypto.randomUUID(), title: title.trim(), objective: objective.trim() }
    api.postMessage({ type: 'prepareBuilder', requestId: request.current.id, objective, useW3c, notes: state.notes.filter(note => selected.includes(note.id))
      .map(note => ({ id: note.id, revision: note.revision })) })
  }
  const notes = state?.notes.filter(note => !note.archived &&
    `${note.title} ${note.tags.join(' ')} ${state.folders.find(folder => folder.id === note.folderId)?.name ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? []
  return <section className="product-builder" aria-label="Product Builder">
    {context}
    <Typography.Title level={2}>Product Builder</Typography.Title>
    <Typography.Paragraph type="secondary">Skill com o objetivo e os textos originais dos cards. A IA sugere passos e verificacoes separadamente, sem alterar as regras.</Typography.Paragraph>
    {!root ? <Empty description="Abra ou crie uma biblioteca no SkillVortex ou MindCards." /> : <>
      {error && <Alert type="error" showIcon message={error} />}
      <Card>
        <div className="builder-fields">
          <label>Titulo da skill<Input aria-label="Titulo da skill gerada" maxLength={100} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
          <label>O que esta skill deve orientar?<Input.TextArea aria-label="Objetivo da skill" rows={4} maxLength={2000}
            value={objective} disabled={busy} onChange={event => setObjective(event.target.value)} /></label>
        </div>
      </Card>
      <Card title="Cards de negocio do MindCards">
        <Input aria-label="Buscar cards para skill" placeholder="Buscar por titulo, etiqueta ou pasta..." value={search}
          disabled={busy} onChange={event => setSearch(event.target.value)} />
        <Typography.Paragraph type="secondary">Selecione ate 8 notas relevantes. Notas relacionadas nao sao incluidas automaticamente.</Typography.Paragraph>
        {!state ? <div role="status">Carregando notas...</div> : !notes.length ? <Empty description="Nenhuma nota ativa encontrada." /> :
          <div className="builder-note-list">{notes.map(note => <Checkbox key={note.id} checked={selected.includes(note.id)}
            disabled={busy || (!selected.includes(note.id) && selected.length >= 8)}
            onChange={event => setSelected(current => event.target.checked ? [...current, note.id] : current.filter(id => id !== note.id))}>
            {note.title} <Tag>{state.folders.find(folder => folder.id === note.folderId)?.name}</Tag>
          </Checkbox>)}</div>}
        <Tag>{selected.length} selecionada(s)</Tag>
      </Card>
      <Checkbox checked={useW3c} disabled={busy} onChange={event => setUseW3c(event.target.checked)}>
        Consultar referencias oficiais do W3C conforme o tema (requer internet e confirmacao)
      </Checkbox>
      {referenceNotice && <Alert type="info" showIcon message={referenceNotice} />}
      <Space wrap>
        <ActionButton action="run" type="primary" loading={busy} disabled={busy || !objective.trim() || !title.trim() || !selected.length}
          onClick={() => void generate()}>Gerar skill</ActionButton>
        <ActionButton action="refresh" disabled={busy} onClick={() => { setError(''); api.postMessage({ type: 'loadMindCards' }) }}>Atualizar cards</ActionButton>
        {busy && pending.current === 'generate' && <ActionButton action="back" onClick={() => {
          worker.current?.terminate()
          resourceController.current?.abort()
          clearTimeout(generationTimer.current)
          if (runtimeModule.current) URL.revokeObjectURL(runtimeModule.current)
          api.postMessage({ type: 'cancelBuilder' })
          worker.current = null
          pending.current = null
          setBusy(false)
          setProgress('Geracao cancelada. Nenhuma skill foi salva.')
        }}>Cancelar geracao</ActionButton>}
      </Space>
      {progress && <Typography.Paragraph role="status">{progress}</Typography.Paragraph>}
      {content && <Card title="Revise o rascunho">
        <Alert type="info" showIcon message="O texto original dos cards foi preservado pelo codigo. Revise a aplicabilidade das regras. Sugestoes da IA nao entram automaticamente nesta skill." />
        <Typography.Paragraph type="secondary">Fontes: {sources.map(source => source.title).join(', ')}</Typography.Paragraph>
        <Input.TextArea aria-label="Rascunho da skill" rows={18} value={content} disabled={busy} maxLength={100000}
          onChange={event => setContent(event.target.value)} />
        <ActionButton action="edit" disabled={busy || !content.trim() || !title.trim()} onClick={() => {
          setError('')
          setBusy(true)
          pending.current = 'open'
          api.postMessage({ type: 'openBuilderSkill', title, content })
        }}>{openSkillLabel}</ActionButton>
      </Card>}
      {suggestions && <Card title="Sugestoes da IA — nao verificadas">
        <Alert type="warning" showIcon message="Podem estar incorretas, genericas ou incompletas. Nao fazem parte da skill salva. Copie apenas o que verificar contra as fontes." />
        <Input.TextArea aria-label="Sugestoes da IA" rows={10} value={suggestions} readOnly />
      </Card>}
    </>}
  </section>
}
