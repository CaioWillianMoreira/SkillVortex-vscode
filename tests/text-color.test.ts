import { afterAll, beforeAll, expect, test } from '@jest/globals'
import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MarkdownManager } from '@tiptap/markdown'

let temporary: string
let manager: () => MarkdownManager
let isTextColor: typeof import('../webview/TextColor').isTextColor
let containsHtmlToken: typeof import('../webview/TextColor').containsHtmlToken
beforeAll(() => {
  temporary = mkdtempSync(join(tmpdir(), 'skillvortex-color-'))
  const outfile = join(temporary, 'color.cjs')
  buildSync({
    stdin: { contents: `
      import { MarkdownManager } from '@tiptap/markdown';
      import StarterKit from '@tiptap/starter-kit';
      import { TextColor } from './webview/TextColor';
      export { isTextColor, containsHtmlToken } from './webview/TextColor';
      export const manager = () => new MarkdownManager({ extensions: [StarterKit, TextColor] });
    `, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile
  })
  ;({ manager, isTextColor, containsHtmlToken } = require(outfile))
})
afterAll(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }) })

test('text colors parse and serialize as controlled spans alongside Markdown formatting', () => {
  const markdown = manager()
  const content = '# Regra\n\nAntes <span style="color: #FF8800">**texto** *colorido*</span> depois.'
  const parsed = markdown.parse(content)
  expect(JSON.stringify(parsed)).toContain('"color":"#ff8800"')
  expect(JSON.stringify(parsed)).toContain('"type":"bold"')
  const saved = markdown.serialize(parsed)
  expect(saved).toContain('<span style="color: #ff8800">')
  expect(markdown.parse(saved)).toEqual(parsed)
})

test.each([
  '#fff', 'red', 'rgb(255,0,0)', '#12345678', '#12345z', 'url(https://example.com)', '#ffffff;position:absolute'
])('rejects unsupported color value %s', value => {
  expect(isTextColor(value)).toBe(false)
})

test('controlled color tokenizer does not absorb unsupported HTML attributes or styles', () => {
  const markdown = manager()
  const source = '<span style="color: #ff0000" onclick="alert(1)">unsafe</span> <span style="color: #ff0000; display:none">hidden</span>'
  const types: string[] = []
  markdown.instance.walkTokens(markdown.instance.lexer(source), token => { types.push(token.type) })
  expect(types).toContain('html')
  expect(types).not.toContain('textColor')
})

test('HTML nested inside an allowed color remains visible to the HTML guard', () => {
  const markdown = manager()
  let blocked = false
  markdown.instance.walkTokens(markdown.instance.lexer('<span style="color: #ff0000"><img src=x onerror=alert(1)></span>'),
    token => { if (containsHtmlToken(token)) blocked = true })
  expect(blocked).toBe(true)
})
