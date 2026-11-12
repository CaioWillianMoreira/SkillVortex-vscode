import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import MindCards from '../../../webview/MindCards'
import './styles.css'

declare function acquireVsCodeApi(): { postMessage(message: unknown): void }
const api = acquireVsCodeApi()

function App(): React.JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data.type === 'standaloneRoot') setRoot(event.data.root)
    }
    window.addEventListener('message', receive)
    api.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', receive)
  }, [])
  return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
    <MindCards root={root} api={api} onDirtyChange={() => {}} onBusyChange={() => {}} />
  </ConfigProvider>
}

createRoot(document.getElementById('root')!).render(<App />)
