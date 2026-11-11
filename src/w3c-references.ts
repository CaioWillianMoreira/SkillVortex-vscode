import { selectW3cDocuments, type BuilderSource } from './product-builder-model'

export async function fetchW3cReferences(objective: string, sources: BuilderSource[], signal: AbortSignal) {
  const references: Array<{ title: string; url: string; html: string }> = []
  for (const document of selectW3cDocuments(objective, sources)) {
    signal.throwIfAborted()
    const response = await fetch(document.url, {
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { Accept: 'text/html' }
    })
    if (!response.ok || !response.body) throw new Error(`Consulta W3C falhou: HTTP ${response.status} em ${document.url}`)
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error(`Resposta W3C nao e HTML: ${document.url}`)
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      size += chunk.length
      if (size > 2 * 1024 * 1024) throw new Error(`Documento W3C excede 2 MB: ${document.url}`)
      chunks.push(chunk)
    }
    references.push({ title: document.title, url: document.url, html: Buffer.concat(chunks).toString('utf8') })
  }
  return references
}
