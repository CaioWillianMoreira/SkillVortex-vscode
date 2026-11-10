import { describe, expect, test } from '@jest/globals'
import { formatMarkdown, type MarkdownCommand } from '../src/markdown-format'

const apply = (source: string, start: number, end: number, command: MarkdownCommand, href?: string) => {
  const edit = formatMarkdown(source, start, end, command, href)
  return source.slice(0, edit.start) + edit.text + source.slice(edit.end)
}

describe('Markdown toolbar editing', () => {
  test.each<[MarkdownCommand, string]>([
    ['bold', '**texto**'], ['italic', '*texto*'], ['strike', '~~texto~~'], ['code', '`texto`']
  ])('wraps and toggles %s without changing surrounding text', (command, formatted) => {
    expect(apply('A texto Z', 2, 7, command)).toBe(`A ${formatted} Z`)
    const markerLength = (formatted.length - 5) / 2
    expect(apply(`A ${formatted} Z`, 2 + markerLength, 7 + markerLength, command)).toBe('A texto Z')
    expect(apply(formatted, 0, formatted.length, command)).toBe('texto')
  })

  test.each(['\n', '\r\n'])('formats complete selected lines and preserves %j', newline => {
    const source = 'alpha' + newline + 'beta' + newline + 'gamma'
    expect(apply(source, 1, 5 + newline.length + 4, 'bullet')).toBe('- alpha' + newline + '- beta' + newline + 'gamma')
    expect(apply(source, 0, 5 + newline.length, 'h2')).toBe('## alpha' + newline + 'beta' + newline + 'gamma')
  })

  test('preserves metadata and rejects toolbar edits inside YAML', () => {
    const metadata = '---\nname: original\ncustom: true\n---\n'
    expect(apply(metadata + 'texto', metadata.length, metadata.length + 5, 'bold')).toBe(metadata + '**texto**')
    expect(() => formatMarkdown(metadata + 'texto', 3, 10, 'bold')).toThrow('YAML')
  })

  test('toggles headings, lists, and recuos on the current line', () => {
    expect(apply('## Title', 4, 4, 'h2')).toBe('Title')
    expect(apply('Title', 2, 2, 'h6')).toBe('###### Title')
    expect(apply('- a\n- b', 0, 7, 'ordered')).toBe('1. a\n2. b')
    expect(apply('a\nb', 0, 3, 'task')).toBe('- [ ] a\n- [ ] b')
    expect(apply('a\nb', 0, 3, 'quote')).toBe('> a\n> b')
    expect(apply('  - a', 2, 3, 'outdent')).toBe('- a')
    expect(apply('- a', 2, 2, 'indent')).toBe('  - a')
  })

  test('clears inline formatting and block styles', () => {
    const source = '## **Bold** *italic* ~~strike~~ `code`'
    expect(apply(source, 0, source.length, 'clear')).toBe('Bold italic strike code')
    expect(apply('> quote', 0, 7, 'paragraph')).toBe('quote')
  })

  test('combines bold and italic without removing the other mark', () => {
    expect(apply('**texto**', 2, 7, 'italic')).toBe('***texto***')
    expect(apply('***texto***', 3, 8, 'italic')).toBe('**texto**')
    expect(apply('**texto**', 0, 9, 'italic')).toBe('***texto***')
    expect(apply('*texto*', 1, 6, 'bold')).toBe('***texto***')
    expect(apply('***texto***', 3, 8, 'bold')).toBe('*texto*')
  })

  test('creates and removes links while preserving parentheses in targets', () => {
    expect(apply('texto', 0, 5, 'link', 'https://example.com/a(b)')).toBe('[texto](https://example.com/a\\(b\\))')
    const source = 'A [texto](https://example.com) Z'
    expect(apply(source, 5, 6, 'unlink')).toBe('A texto Z')
    expect(() => formatMarkdown('texto', 0, 5, 'unlink')).toThrow('Selecione um link')
  })

  test('inserts Markdown blocks with safe code fences', () => {
    expect(apply('`code`', 0, 6, 'codeBlock')).toBe('\n```\n`code`\n```\n')
    expect(apply('```', 0, 3, 'codeBlock')).toBe('\n````\n```\n````\n')
    expect(apply('text', 4, 4, 'rule')).toBe('text\n\n---\n\n')
    expect(apply('text', 4, 4, 'table')).toContain('| Coluna 1 | Coluna 2 |\n| --- | --- |')
  })
})
