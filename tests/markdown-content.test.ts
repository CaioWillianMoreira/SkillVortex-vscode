import { describe, expect, test } from '@jest/globals'
import { replaceMarkdownBody, splitMarkdown } from '../src/markdown-content'

describe('Markdown content and metadata', () => {
  test.each(['\n', '\r\n'])('preserves metadata exactly with %j line endings', newline => {
    const metadata = ['---', '# comment', 'name: teste', 'custom: [a, b]', '---', ''].join(newline)
    const source = metadata + newline + '# Original'
    expect(splitMarkdown(source)).toEqual({ metadata, body: newline + '# Original' })
    expect(replaceMarkdownBody(source, '**Novo**\n\nTexto')).toBe(metadata + ['**Novo**', '', 'Texto'].join(newline))
  })

  test('keeps content without metadata and thematic breaks', () => {
    const body = '# Title\n\n---\n\nBody'
    expect(splitMarkdown(body)).toEqual({ metadata: '', body })
    expect(replaceMarkdownBody(body, '*New*')).toBe('*New*')
  })

  test('does not hide an unclosed metadata block', () => {
    expect(splitMarkdown('---\nname: text').body).toBe('---\nname: text')
  })

  test.each(['', '# Novo corpo', '---\nname: acidental\n---\nTexto'])('protects the original metadata when replacing the whole editable body with %j', body => {
    const metadata = '---\nname: original\ndescription: "Preservar"\n---\n'
    expect(replaceMarkdownBody(metadata + '# Antigo', body)).toBe(metadata + body)
  })

  test('preserves BOM and separates metadata closed at EOF from new text', () => {
    const metadata = '\uFEFF---\nname: teste\n---'
    expect(splitMarkdown(metadata)).toEqual({ metadata, body: '' })
    expect(replaceMarkdownBody(metadata, 'New')).toBe(metadata + '\nNew')
  })
})
