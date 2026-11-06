import { test, expect } from '@jest/globals'
import { catalogSchema, skillCards, skillSchema, skillSlug, uniqueSkillFilePath } from '../src/model'
import { createCardExamples, createDocumentedExamples, reconcileDocumentedExamples } from '../src/documented-examples'
import { skillMarkdownMetadata } from '../src/project-skills'
import { SKILL_CARD_COLORS } from '../src/skill-colors'

test('creates exactly four fully populated cards with 1, 4, 2 and 0 independent skills', () => {
  const categories = ['Geral', 'Arquitetura', 'Git', 'DevOps', 'SEO']
  const examples = createCardExamples(categories)
  const catalog = catalogSchema.parse({ version: 1, categories, collections: examples.cards,
    skills: examples.skills.map(item => item.skill) })
  expect(skillCards(catalog)).toHaveLength(4)
  expect(skillCards(catalog).map(card => card.skillIds.length)).toEqual([1, 4, 2, 0])
  expect(examples.skills).toHaveLength(7)
  expect(new Set(examples.skills.map(item => item.skill.filePath)).size).toBe(7)
  expect(new Set(examples.skills.map(item => item.skill.category))).toEqual(new Set(categories))
  for (const card of skillCards(catalog)) {
    expect(card.name.trim()).not.toBe('')
    expect(card.description.trim()).not.toBe('')
    expect(card.tags.length).toBeGreaterThan(0)
    expect(card.agents).toEqual(['GitHub Copilot', 'Antigravity'])
    expect(card.status).toBe('pending')
    expect(card.cardColor).toBeDefined()
    expect(categories).toContain(card.category)
  }
  for (const { skill, content } of examples.skills) {
    expect(skillMarkdownMetadata(content)).toEqual({ name: skillSlug(skill.name), description: skill.description })
    expect(content).toContain('## Procedimento')
    expect(categories).toContain(skill.category)
  }
})

test('example cards use only available categories and require at least one', () => {
  const examples = createCardExamples(['Custom'])
  expect(examples.cards.every(card => card.category === 'Custom')).toBe(true)
  expect(examples.skills.every(item => item.skill.category === 'Custom')).toBe(true)
  expect(() => createCardExamples([])).toThrow('categoria')
})

test('creates the eight documented, editable skill cards with valid metadata and Markdown', () => {
  const examples = createDocumentedExamples()

  expect(examples).toHaveLength(8)
  expect(examples.map(({ skill }) => skill.name)).toEqual([
    'Acessibilidade Web',
    'Clean Architecture TS',
    'Git Flow & Boas Práticas',
    'Integração Contínua (CI)',
    'Padronização de API REST',
    'Segurança da Informação',
    'SEO Optimization',
    'Testes Unitários com Vitest'
  ])
  expect(examples.map(({ skill }) => skill.status)).toEqual([
    'blocked', 'pending', 'validated', 'pending',
    'validated', 'validated', 'validated', 'pending'
  ])
  expect(examples[4].skill.agents).toEqual(['Antigravity'])
  expect(examples[4].skill.description).toBe('Boas práticas para definição de contratos e endpoints.')
  expect(examples[7].skill.filePath).toBe('skills/testes-unitarios-com-vitest.md')
  expect(new Set(examples.map(({ skill }) => skill.id)).size).toBe(examples.length)
  expect(new Set(examples.map(({ skill }) => skill.filePath)).size).toBe(examples.length)

  for (const { skill, content } of examples) {
    expect(skillSchema.parse(skill)).toEqual(skill)
    expect(content).toContain(`# ${skill.name}`)
    expect(content).toContain(skill.description)
    expect(content.length).toBeGreaterThan(skill.name.length)
  }
})

test('creates readable slugs and unique file names from skill titles', () => {
  expect(skillSlug('Verifica consistência do HTML')).toBe('verifica-consistencia-do-html')
  expect(uniqueSkillFilePath('Verifica consistência do HTML', [])).toBe(
    'skills/verifica-consistencia-do-html.md'
  )
  expect(uniqueSkillFilePath('Verifica consistência do HTML', [
    'skills/verifica-consistencia-do-html.md'
  ])).toBe('skills/verifica-consistencia-do-html-2.md')
})

test('reconciles existing documented cards without replacing their IDs, paths, or Markdown', () => {
  const examples = createDocumentedExamples()
  const oldRestApi = {
    ...examples[4].skill,
    id: 'existing-rest-id',
    filePath: 'skills/existing-rest.md',
    name: 'REST API',
    status: 'pending' as const,
    agents: ['GitHub Copilot', 'Antigravity'],
    description: 'Boas praticas para definicao de contratos e endpoints.',
    cardColor: SKILL_CARD_COLORS[6]
  }
  const oldAccessibility = {
    ...examples[0].skill,
    id: 'existing-accessibility-id',
    filePath: 'skills/existing-accessibility.md',
    status: 'pending' as const
  }
  const skills = [oldRestApi, oldAccessibility]

  const result = reconcileDocumentedExamples(skills, examples)

  expect(result.updated).toBe(2)
  expect(result.toCreate).toHaveLength(6)
  expect(result.blockedSkillIds).toEqual(['existing-accessibility-id'])
  expect(result.orderedSkillIds).toEqual([
    'existing-accessibility-id',
    examples[1].skill.id,
    examples[2].skill.id,
    examples[3].skill.id,
    'existing-rest-id',
    examples[5].skill.id,
    examples[6].skill.id,
    examples[7].skill.id
  ])
  expect(oldRestApi).toMatchObject({
    id: 'existing-rest-id',
    filePath: 'skills/existing-rest.md',
    name: 'Padronização de API REST',
    status: 'validated',
    agents: ['Antigravity'],
    cardColor: SKILL_CARD_COLORS[6],
    description: 'Boas práticas para definição de contratos e endpoints.'
  })
})

test('leaves already matching documented cards unchanged', () => {
  const examples = createDocumentedExamples()
  const skills = examples.map(({ skill }) => ({ ...skill }))

  expect(reconcileDocumentedExamples(skills, examples)).toEqual({
    toCreate: [], updated: 0, blockedSkillIds: [examples[0].skill.id],
    orderedSkillIds: examples.map(({ skill }) => skill.id)
  })
})
