import { splitMarkdown } from './markdown-content'

export type MarkdownCommand = 'bold' | 'italic' | 'strike' | 'code' | 'clear' | 'paragraph' |
  'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'bullet' | 'ordered' | 'task' | 'indent' | 'outdent' |
  'link' | 'unlink' | 'quote' | 'codeBlock' | 'rule' | 'table'

export interface MarkdownEdit {
  start: number
  end: number
  text: string
  selectionStart: number
  selectionEnd: number
}

export function formatMarkdown(source: string, start: number, end: number, command: MarkdownCommand, href?: string): MarkdownEdit {
  const { metadata } = splitMarkdown(source)
  if (start < metadata.length || end < start || end > source.length) {
    throw new Error('Selecione o conteudo Markdown fora do cabecalho YAML.')
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const selected = source.slice(start, end)
  const result = (from: number, to: number, text: string, offset = 0, length = text.length): MarkdownEdit =>
    ({ start: from, end: to, text, selectionStart: from + offset, selectionEnd: from + offset + length })
  const markers: Partial<Record<MarkdownCommand, string>> = { bold: '**', italic: '*', strike: '~~', code: '`' }
  const marker = markers[command]
  if (marker) {
    const hasMarker = (before: string, after: string) => {
      if (!before.endsWith(marker) || !after.startsWith(marker)) return false
      if (command !== 'italic') return true
      return (before.match(/\*+$/)?.[0].length ?? 0) % 2 === 1 && (after.match(/^\*+/)?.[0].length ?? 0) % 2 === 1
    }
    if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker) &&
        hasMarker(selected.match(/^[*~`]+/)?.[0] ?? '', selected.match(/[*~`]+$/)?.[0] ?? '')) {
      return result(start, end, selected.slice(marker.length, -marker.length))
    }
    if (hasMarker(source.slice(0, start), source.slice(end))) {
      return result(start - marker.length, end + marker.length, selected)
    }
    const text = selected || 'texto'
    return result(start, end, marker + text + marker, marker.length, text.length)
  }
  if (command === 'link') {
    if (!href) throw new Error('Informe o endereco do link.')
    const text = selected || 'link'
    const target = href.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    return result(start, end, `[${text}](${target})`, 1, text.length)
  }
  let from = Math.max(metadata.length, source.lastIndexOf('\n', start - 1) + 1)
  const last = end > start && source[end - 1] === '\n' ? end - newline.length : end
  const nextLine = source.indexOf('\n', last)
  let to = nextLine < 0 ? source.length : nextLine
  if (source[to - 1] === '\r') to--
  if (command === 'unlink') {
    const line = source.slice(from, to)
    const link = Array.from(line.matchAll(/\[([^\]]*)\]\((?:\\.|[^)])*\)/g)).find(match =>
      from + match.index <= start && from + match.index + match[0].length >= end)
    if (!link) throw new Error('Selecione um link Markdown para remove-lo.')
    return result(from + link.index, from + link.index + link[0].length, link[1])
  }
  if (command === 'rule' || command === 'table') {
    const block = command === 'rule' ? '---' : '| Coluna 1 | Coluna 2 |\n| --- | --- |\n| Texto | Texto |'
    return result(end, end, newline + newline + block.replace(/\n/g, newline) + newline + newline)
  }
  if (command === 'codeBlock') {
    const text = selected || 'codigo'
    const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)))
    return result(start, end, `${newline}${fence}${newline}${text}${newline}${fence}${newline}`, newline.length * 2 + fence.length, text.length)
  }
  if (from > to) { from = start; to = end }
  const lines = source.slice(from, to).split(/\r?\n/)
  const stripBlock = (line: string) => line.replace(/^(\s*)(?:#{1,6}\s+|>\s?|(?:[-+*]|\d+\.)\s+(?:\[[ xX]\]\s+)?)/, '$1')
  const prefixes: Partial<Record<MarkdownCommand, string>> = { bullet: '- ', task: '- [ ] ', quote: '> ',
    h1: '# ', h2: '## ', h3: '### ', h4: '#### ', h5: '##### ', h6: '###### ' }
  const prefix = prefixes[command]
  const removePrefix = prefix && lines.every(line => line.startsWith(prefix))
  const text = lines.map((line, index) => {
    if (command === 'indent') return '  ' + line
    if (command === 'outdent') return line.replace(/^(?: {1,2}|\t)/, '')
    if (command === 'clear') return stripBlock(line)
      .replace(/(\*\*|__|~~)(.*?)\1/g, '$2').replace(/([*_`])(.+?)\1/g, '$2')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    if (command === 'paragraph') return stripBlock(line)
    if (command === 'ordered') return `${index + 1}. ${stripBlock(line)}`
    return removePrefix ? line.slice(prefix.length) : (prefix ?? '') + stripBlock(line)
  }).join(newline)
  return result(from, to, text)
}
