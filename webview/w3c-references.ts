import { w3cDocuments, type BuilderReference } from '../src/product-builder-model'

export function readW3cExcerpts(documents: Array<{ title: string; url: string; html: string }>): BuilderReference[] {
  return documents.map(document => {
    const official = w3cDocuments.find(item => item.url === document.url)
    if (!official) throw new Error('Referencia fora do catalogo oficial W3C.')
    const template = window.document.createElement('template')
    template.innerHTML = document.html
    const parsed = template.content
    parsed.querySelectorAll('script, style, nav, header, footer, aside').forEach(element => element.remove())
    const main = parsed.querySelector('main, [role="main"]')
    const content = main?.textContent?.replace(/\s+/g, ' ').trim()
    if (!content || content.length < 100) throw new Error(`Nao foi possivel extrair conteudo util do W3C: ${document.url}`)
    return { title: official.title, url: official.url, content: content.slice(0, 1200) + (content.length > 1200 ? ' [Trecho limitado a 1.200 caracteres.]' : '') }
  })
}
