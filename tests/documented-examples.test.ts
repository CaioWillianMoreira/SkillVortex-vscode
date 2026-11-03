import { test, expect } from '@jest/globals'
import { skillSchema } from '../src/model'
import { createDocumentedExamples, reconcileDocumentedExamples } from '../src/documented-examples'

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
  expect(new Set(examples.map(({ skill }) => skill.id)).size).toBe(examples.length)
  expect(new Set(examples.map(({ skill }) => skill.filePath)).size).toBe(examples.length)

  for (const { skill, content } of examples) {
    expect(skillSchema.parse(skill)).toEqual(skill)
    expect(content).toContain(`# ${skill.name}`)
    expect(content).toContain(skill.description)
    expect(content.length).toBeGreaterThan(skill.name.length)
  }
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
    description: 'Boas praticas para definicao de contratos e endpoints.'
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
