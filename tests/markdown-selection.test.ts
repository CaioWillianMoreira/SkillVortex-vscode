import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'
import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarkdownCommand } from '../src/markdown-format'

let temporary: string
let createMarkdownSelection: typeof import('../webview/markdown-selection').createMarkdownSelection
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), 'skillvortex-selection-'))
  const outfile = join(temporary, 'selection.cjs')
  buildSync({ entryPoints: ['webview/markdown-selection.ts'], bundle: true, platform: 'node', format: 'cjs', outfile })
  ;({ createMarkdownSelection } = require(outfile))
})
afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }) })

describe('Markdown selection formatting', () => {
  test.each<[string, MarkdownCommand[]]>([
    ['**texto**', ['paragraph', 'bold']],
    ['__texto__', ['paragraph', 'bold']],
    ['*texto*', ['paragraph', 'italic']],
    ['_texto_', ['paragraph', 'italic']],
    ['***texto***', ['paragraph', 'italic', 'bold']],
    ['~~**texto**~~', ['paragraph', 'strike', 'bold']],
    ['`**texto**`', ['paragraph', 'code']],
    ['## **texto**', ['h2', 'bold']],
    ['texto\n=====', ['h1']],
    ['> **texto**', ['quote', 'paragraph', 'bold']],
    ['- texto', ['bullet', 'paragraph']],
    ['1. texto', ['ordered', 'paragraph']],
    ['- [x] texto', ['task', 'paragraph']],
    ['```md\n**texto**\n```', ['codeBlock']],
    ['    **texto**', ['codeBlock']],
    ['\\*\\*texto\\*\\*', ['paragraph']],
    ['plain texto', ['paragraph']]
  ])('recognizes cursor and selection formatting in %j', (source, expected) => {
    const start = source.indexOf('texto')
    const at = createMarkdownSelection(source)
    expect(at(start + 2, start + 2).active.sort()).toEqual([...expected].sort())
    expect(at(start, start + 5).active.sort()).toEqual([...expected].sort())
  })

  test('does not highlight marks across mixed selections or after a closing delimiter', () => {
    const source = '**bold** plain *italic*'
    const at = createMarkdownSelection(source)
    expect(at(2, 14).active).toEqual(['paragraph'])
    expect(at(8, 8).active).toEqual(['paragraph'])
    expect(at(16, 20).active).toContain('italic')
  })

  test.each(['\n', '\r\n'])('preserves offsets with YAML and %j', newline => {
    const metadata = ['---', 'name: teste', '---', ''].join(newline)
    const source = metadata + '## **texto**'
    const at = createMarkdownSelection(source)
    expect(at(5, 5).active).toEqual([])
    expect(at(source.indexOf('texto'), source.indexOf('texto') + 5).active.sort()).toEqual(['bold', 'h2'])
  })

  test('recognizes direct and reference links with nested marks', () => {
    for (const source of ['[**texto**](https://example.com)', '[**texto**][ref]\n\n[ref]: https://example.com']) {
      const start = source.indexOf('texto')
      const selected = createMarkdownSelection(source)(start, start + 5)
      expect(selected.active.sort()).toEqual(['bold', 'link', 'paragraph'])
      expect(selected.linkHref).toBe('https://example.com')
    }
  })

  test.each(['\n', '\r\n'])('recognizes title boundaries and line selections with %j', newline => {
    const metadata = ['---', 'name: teste', '---', ''].join(newline)
    const title = '# Revisar alteracoes'
    const source = metadata + title + newline + newline + '## Quando usar' + newline
    const at = createMarkdownSelection(source)
    const start = metadata.length
    const end = start + title.length
    expect(at(end, end).active).toEqual(['h1'])
    expect(at(start, end + newline.length).active).toEqual(['h1'])
    expect(at(start + 2, end + newline.length).active).toEqual(['h1'])
    expect(at(end + newline.length, end + newline.length).active).toEqual([])
    expect(at(start, end + newline.length * 2).active).toEqual([])
    expect(at(start, source.length).active).toEqual([])
    expect(at(source.length - newline.length, source.length - newline.length).active).toEqual(['h2'])
  })

  test.each<[string, MarkdownCommand[]]>([
    ['# titulo', ['h1']],
    ['texto', ['paragraph']],
    ['- texto', ['bullet', 'paragraph']],
    ['- [ ] texto', ['task', 'paragraph']],
    ['> texto', ['quote', 'paragraph']],
    ['```js\ntexto\n```', ['codeBlock']],
    ['**texto**', ['paragraph']]
  ])('recognizes block formatting at EOF in %j', (source, expected) => {
    expect(createMarkdownSelection(source)(source.length, source.length).active.sort()).toEqual([...expected].sort())
  })

  test('keeps inline mark boundaries exclusive while accepting a selected formatted line', () => {
    const source = '**texto**\nplain'
    const at = createMarkdownSelection(source)
    expect(at(0, 10).active.sort()).toEqual(['bold', 'paragraph'])
    expect(at(9, 9).active).toEqual(['paragraph'])
    expect(at(10, 10).active).toEqual(['paragraph'])
    expect(at(2, 12).active).toEqual(['paragraph'])
  })
})
