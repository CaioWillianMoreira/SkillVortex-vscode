import { randomBytes } from 'node:crypto'
import type { Skill } from './model'

const examples: Array<Omit<Skill, 'id' | 'filePath'> & { markdown: string; aliases?: string[] }> = [
  {
    name: 'Acessibilidade Web',
    category: 'Acessibilidade',
    description: 'Diretrizes de inclusividade e design semântico universal.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'blocked',
    tags: ['a11y', 'wcag'],
    markdown: '## Diretrizes\n\n- Use HTML semantico e rotulos acessiveis.\n- Garanta contraste adequado e navegacao por teclado.\n- Revise a experiencia com tecnologias assistivas.'
  },
  {
    name: 'Clean Architecture TS',
    category: 'Arquitetura',
    description: 'Padrões de design TypeScript robustos e escaláveis.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'pending',
    tags: ['ts', 'patterns'],
    markdown: '## Diretrizes\n\n- Separe dominio, aplicacao e infraestrutura.\n- Adicione as instrucoes desta skill ao contexto.\n- Revise o conteudo antes de validar.'
  },
  {
    name: 'Git Flow & Boas Práticas',
    category: 'Git',
    description: 'Diretrizes de ramificação, commits e versionamento.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'validated',
    tags: ['git', 'workflow'],
    markdown: '## Diretrizes\n\n- Use branches curtas e com nomes descritivos.\n- Escreva commits pequenos e objetivos.\n- Integre por pull request com revisao.'
  },
  {
    name: 'Integração Contínua (CI)',
    category: 'DevOps',
    description: 'Pipelines de integração contínua consistentes e seguros.',
    agents: ['GitHub Copilot'],
    status: 'pending',
    tags: ['ci', 'actions'],
    markdown: '## Diretrizes\n\n- Execute lint, testes e build em cada alteracao.\n- Mantenha etapas reproduziveis e com falhas visiveis.\n- Armazene credenciais em secrets do ambiente.'
  },
  {
    name: 'Padronização de API REST',
    category: 'API',
    description: 'Boas práticas para definição de contratos e endpoints.',
    agents: ['Antigravity'],
    status: 'validated',
    tags: ['api', 'rest'],
    aliases: ['REST API'],
    markdown: '## Diretrizes\n\n- Defina recursos e contratos HTTP consistentes.\n- Valide entradas e documente respostas e erros.\n- Mantenha compatibilidade entre versões.'
  },
  {
    name: 'Segurança da Informação',
    category: 'Segurança',
    description: 'Práticas para proteger aplicações, dados e usuários.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'validated',
    tags: ['security', 'compliance'],
    markdown: '## Diretrizes\n\n- Minimize a coleta e exposicao de dados.\n- Valide entradas e proteja credenciais.\n- Revise dependencias e controles de acesso.'
  },
  {
    name: 'SEO Optimization',
    category: 'SEO',
    description: 'Técnicas on-page e off-page para melhorar a descoberta.',
    agents: ['Antigravity'],
    status: 'validated',
    tags: ['seo', 'metadata'],
    markdown: '## Diretrizes\n\n- Use titulos, descricoes e URLs claros.\n- Estruture o conteudo com cabecalhos semanticos.\n- Adicione metadados e dados estruturados relevantes.'
  },
  {
    name: 'Testes Unitários com Vitest',
    category: 'Testes',
    description: 'Escreva testes de unidade claros, rápidos e confiáveis.',
    agents: ['GitHub Copilot'],
    status: 'pending',
    tags: ['testing', 'vitest'],
    markdown: '## Diretrizes\n\n- Teste comportamento observavel e casos limite.\n- Mantenha cada teste independente e deterministico.\n- Use nomes que expliquem o resultado esperado.'
  }
]

export function createDocumentedExamples(): Array<{ skill: Skill; content: string }> {
  return examples.map(({ markdown, aliases: _aliases, ...metadata }) => {
    const skill: Skill = {
      ...metadata,
      id: randomBytes(16).toString('hex'),
      filePath: `skills/${randomBytes(16).toString('hex')}.md`
    }
    return { skill, content: `# ${skill.name}\n\n${skill.description}\n\n${markdown}\n` }
  })
}

export function getDocumentedExampleAliases(name: string): string[] {
  return examples.find(example => example.name === name)?.aliases ?? []
}

export function reconcileDocumentedExamples(
  skills: Skill[],
  documented = createDocumentedExamples()
): { toCreate: typeof documented; updated: number; blockedSkillIds: string[]; orderedSkillIds: string[] } {
  const normalizeName = (name: string) => name.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
  const toCreate: typeof documented = []
  const blockedSkillIds: string[] = []
  const orderedSkillIds: string[] = []
  let updated = 0
  for (const example of documented) {
    const names = [example.skill.name, ...getDocumentedExampleAliases(example.skill.name)]
      .map(normalizeName)
    const existing = skills.find(skill => names.includes(normalizeName(skill.name)))
    if (!existing) {
      toCreate.push(example)
      orderedSkillIds.push(example.skill.id)
      continue
    }
    orderedSkillIds.push(existing.id)
    if (example.skill.status === 'blocked') blockedSkillIds.push(existing.id)
    if (existing.name !== example.skill.name ||
        existing.category !== example.skill.category ||
        existing.description !== example.skill.description ||
        existing.status !== example.skill.status ||
        JSON.stringify(existing.tags) !== JSON.stringify(example.skill.tags) ||
        JSON.stringify(existing.agents) !== JSON.stringify(example.skill.agents)) {
      Object.assign(existing, {
        name: example.skill.name,
        category: example.skill.category,
        description: example.skill.description,
        status: example.skill.status,
        tags: example.skill.tags,
        agents: example.skill.agents
      })
      updated++
    }
  }
  return { toCreate, updated, blockedSkillIds, orderedSkillIds }
}
