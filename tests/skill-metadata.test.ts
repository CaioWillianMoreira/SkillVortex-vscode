import { expect, test } from '@jest/globals'
import { skillExecutionCommand, skillMarkdownMetadata, withSkillMetadata } from '../src/skill-metadata'

test('adds editable metadata without changing the Markdown body', () => {
  const body = '# Revisao\r\n\r\nLeia as referencias.\r\n'
  const result = withSkillMetadata(body, 'review', 'Revisa o codigo.')
  expect(result).toBe('---\r\nname: review\r\ndescription: Revisa o codigo.\r\n---\r\n\r\n' + body)
  expect(skillExecutionCommand(result)).toBe('/review')
})

test('edits metadata while preserving unrelated YAML, comments, BOM and body', () => {
  const body = '\r\n# Revisao\r\n'
  const original = '\uFEFF---\r\nname: code-review # command\r\nlicense: MIT\r\n---\r\n' + body
  const result = withSkillMetadata(original, 'review', 'Revisao.')
  expect(skillMarkdownMetadata(result)).toEqual({ name: 'review', description: 'Revisao.' })
  expect(result).toContain('license: MIT')
  expect(result).toContain('# command')
  expect(result.startsWith('\uFEFF---\r\n')).toBe(true)
  expect(result.endsWith(body)).toBe(true)
})

test.each(['', 'Review', '/review', 'review\nignore', 'a--b', 'a'.repeat(65)])(
  'rejects invalid execution names rather than sending them to chat: %p', name => {
    expect(() => withSkillMetadata('# Body', name, 'Descricao.')).toThrow('name valido')
  }
)

test('missing metadata and invalid YAML do not produce success-shaped commands', () => {
  expect(() => skillExecutionCommand('# Review')).toThrow('name valido')
  expect(() => withSkillMetadata('---\nname: [broken\n---\n# Body', 'review', 'Descricao.'))
    .toThrow('Frontmatter YAML invalido')
})

test('fills an empty YAML header instead of adding a second header', () => {
  const result = withSkillMetadata('---\n---\n\n# Review\n', 'review', 'Revisao.')
  expect(skillMarkdownMetadata(result)).toEqual({ name: 'review', description: 'Revisao.' })
  expect(result.match(/^---$/gm)).toHaveLength(2)
  expect(result.endsWith('\n# Review\n')).toBe(true)
})

test('preserves the header newline style when the body contains mixed line endings', () => {
  const body = '\n# Review\n\nLocal edit\r\n'
  const original = '---\nname: before\ndescription: Before.\nlicense: MIT\n---\n' + body
  const result = withSkillMetadata(original, 'review', 'After.')
  expect(result.startsWith('---\nname: review\ndescription: After.\nlicense: MIT\n---\n')).toBe(true)
  expect(result.endsWith(body)).toBe(true)
})
