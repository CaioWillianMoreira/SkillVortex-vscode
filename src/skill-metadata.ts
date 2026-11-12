import { isMap, parseDocument } from 'yaml'
import { skillSlug, skillPublicationPath } from './model'
import { splitMarkdown } from './markdown-content'

export function skillMarkdownMetadata(content: string): { name?: string; description?: string } {
  const { metadata } = splitMarkdown(content)
  if (!metadata) {
    if (/^\uFEFF?---\r?\n/.test(content)) throw new Error('Frontmatter YAML invalido: falta o delimitador de fechamento.')
    return {}
  }
  const document = parseDocument(metadata.replace(/^\uFEFF?---\r?\n/, '').replace(/(?:\r?\n)?---(?:\r?\n|$)$/, ''))
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) {
    throw new Error(`Frontmatter YAML invalido. ${document.errors.map(error => error.message).join(' ')}`)
  }
  const name = document.get('name')
  const description = document.get('description')
  if ((name !== undefined && (typeof name !== 'string' || !name.trim())) ||
      (description !== undefined && (typeof description !== 'string' || !description.trim()))) {
    throw new Error('Os campos name e description do frontmatter devem ser textos nao vazios.')
  }
  return { name: typeof name === 'string' ? name : undefined,
    description: typeof description === 'string' ? description : undefined }
}

export function skillExecutionCommand(content: string): string {
  return executionCommand(skillMarkdownMetadata(content).name)
}

function executionCommand(name: string | undefined): string {
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    throw new Error('Informe um name valido no editor da skill: ate 64 letras minusculas, numeros e hifens, sem /.')
  }
  return `/${name}`
}

export function suggestedExecutionName(skill: { name: string; publicationPath?: string; originPath?: string }): string {
  const parts = skillPublicationPath(skill)?.split('/') ?? []
  const filename = parts.pop()
  return skillSlug(filename && /^skill\.md$/i.test(filename)
    ? parts.pop() ?? skill.name : filename?.replace(/(?:\.prompt)?\.md$/i, '') ?? skill.name)
}

export function withSkillMetadata(content: string, name: string, description: string): string {
  executionCommand(name)
  if (!description.trim() || description.length > 1024) throw new Error('Informe uma descricao de ate 1024 caracteres.')
  skillMarkdownMetadata(content)
  const { metadata, body } = splitMarkdown(content)
  const newline = (metadata || content).match(/\r?\n/)?.[0] ?? '\n'
  const document = parseDocument(metadata
    ? metadata.replace(/^\uFEFF?---\r?\n/, '').replace(/(?:\r?\n)?---(?:\r?\n|$)$/, '') : '{}')
  if (isMap(document.contents)) document.contents.flow = false
  document.set('name', name)
  document.set('description', description)
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  return `${bom}---${newline}${document.toString().replace(/\r?\n/g, newline)}---${newline}${
    metadata ? body : `${newline}${body.replace(/^\uFEFF/, '')}`}`
}
