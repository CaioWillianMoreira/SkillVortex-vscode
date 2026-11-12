import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import ProductBuilder from '../../../webview/ProductBuilder'
import './styles.css'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()

function App(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data.type === 'standaloneRoot') setRoot(event.data.root)
      if (event.data.type === 'standaloneNotice') setNotice(event.data.message)
    }
    window.addEventListener('message', receive)
    api.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', receive)
  }, [])
  const opened = useCallback(() => setNotice('Rascunho aberto como documento Markdown para revisao; ainda nao foi salvo.'), [])
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <ProductBuilder root={root} api={api} onDirtyChange={() => {}} onBusyChange={() => {}} onOpenSkill={opened}
      openSkillLabel="Abrir rascunho Markdown" />
    {notice && <p role="status">{notice}</p>}
  </ConfigProvider>
}

createRoot(document.getElementById('root')!).render(<App />)
