export function splitMarkdown(content: string): { metadata: string; body: string } {
  const metadata = content.match(/^\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/)?.[0] ?? ''
  return { metadata, body: content.slice(metadata.length) }
}

export function replaceMarkdownBody(content: string, body: string): string {
  const { metadata } = splitMarkdown(content)
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const normalized = body.replace(/\r?\n/g, newline)
  return metadata + (metadata && !metadata.endsWith('\n') ? newline : '') + normalized
}
