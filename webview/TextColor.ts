import { Mark, type MarkdownToken } from '@tiptap/core'

export const isTextColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

// Marked does not walk children of custom tokens registered by Tiptap.
export function containsHtmlToken(token: MarkdownToken): boolean {
  return token.type === 'html' || Boolean(token.tokens?.some(containsHtmlToken))
}

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return { color: { default: null } }
  },
  parseHTML() {
    return [{
      tag: 'span',
      getAttrs: element => {
        const style = element.getAttribute('style') ?? ''
        const match = style.match(/^\s*color:\s*(#[0-9a-f]{6})\s*;?\s*$/i)
        return match && element.attributes.length === 1 ? { color: match[1].toLowerCase() } : false
      }
    }]
  },
  renderHTML({ mark }) {
    const color: unknown = mark.attrs.color
    if (!isTextColor(color)) throw new Error('Cor de texto invalida.')
    return ['span', { style: `color: ${color.toLowerCase()}` }, 0]
  },
  markdownTokenName: 'textColor',
  markdownTokenizer: {
    name: 'textColor',
    level: 'inline',
    start: '<span',
    tokenize(source, _tokens, lexer) {
      const match = source.match(/^<span style="color:\s*(#[0-9a-f]{6})">([\s\S]*?)<\/span>/i)
      if (!match) return undefined
      return { type: 'textColor', raw: match[0], color: match[1].toLowerCase(), tokens: lexer.inlineTokens(match[2]) }
    }
  },
  parseMarkdown(token, helpers) {
    return helpers.applyMark('textColor', helpers.parseInline(token.tokens ?? []), { color: token.color })
  },
  renderMarkdown(node, helpers) {
    const color: unknown = node.attrs?.color
    const content = helpers.renderChildren(node)
    if (!isTextColor(color)) throw new Error('Cor de texto invalida.')
    return `<span style="color: ${color.toLowerCase()}">${content}</span>`
  }
})
