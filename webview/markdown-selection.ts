import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Root, RootContent } from 'mdast'
import { splitMarkdown } from '../src/markdown-content'
import type { MarkdownCommand } from '../src/markdown-format'

export interface MarkdownSelection {
  active: MarkdownCommand[]
  linkHref?: string
}

export function createMarkdownSelection(source: string): (start: number, end: number) => MarkdownSelection {
  const { metadata, body } = splitMarkdown(source)
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const definitions = new Map(tree.children.filter(node => node.type === 'definition')
    .map(node => [node.identifier.toUpperCase(), node.url]))
  return (start, end) => {
    const active = new Set<MarkdownCommand>()
    let linkHref: string | undefined
    if (start < metadata.length || end < start || end > source.length) return { active: [] }
    const from = start - metadata.length
    let to = end - metadata.length
    if (to > from && body[to - 1] === '\n') {
      to--
      if (body[to - 1] === '\r') to--
    }
    const visit = (node: Root | RootContent) => {
      const first = node.position?.start.offset
      const last = node.position?.end.offset
      const block = node.type === 'root' || node.type === 'heading' || node.type === 'paragraph' ||
        node.type === 'blockquote' || node.type === 'list' || node.type === 'listItem' || node.type === 'code'
      if (first === undefined || last === undefined || from < first || to > last ||
          (from === to && from === last && !block)) return
      switch (node.type) {
        case 'strong': active.add('bold'); break
        case 'emphasis': active.add('italic'); break
        case 'delete': active.add('strike'); break
        case 'inlineCode': active.add('code'); break
        case 'code': active.add('codeBlock'); break
        case 'heading': active.add(`h${node.depth}`); break
        case 'paragraph': active.add('paragraph'); break
        case 'blockquote': active.add('quote'); break
        case 'list': active.add(node.ordered ? 'ordered' : 'bullet'); break
        case 'listItem':
          if (node.checked !== null && node.checked !== undefined) {
            active.delete('bullet')
            active.add('task')
          }
          break
        case 'link': linkHref = node.url; active.add('link'); break
        case 'linkReference':
          linkHref = definitions.get(node.identifier.toUpperCase())
          if (linkHref !== undefined) active.add('link')
          break
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
    return { active: [...active], linkHref }
  }
}
