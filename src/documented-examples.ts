import { randomBytes } from 'node:crypto'
import { skillSlug, uniqueSkillFilePath, type Catalog, type Skill } from './model'

export function createCardExamples(categories: string[]): {
  cards: NonNullable<Catalog['collections']>; skills: Array<{ skill: Skill; content: string }>
} {
  if (!categories.length) throw new Error('Crie pelo menos uma categoria antes de carregar exemplos.')
  const category = (preferred: string) => categories.includes(preferred) ? preferred : categories[0]
  const definitions = [
    { name: 'Arquitetura essencial', category: category('Arquitetura'), description: 'Uma skill para revisar a organizacao do codigo.', tags: ['arquitetura', 'revisao'], color: '#1677ff' as const,
      skills: [{ name: 'Revisar arquitetura', category: category('Arquitetura'), description: 'Revise a separacao de responsabilidades ao alterar a estrutura do projeto.', steps: ['Separe dominio, aplicacao e infraestrutura.', 'Evite dependencias circulares.', 'Execute os testes afetados.'] }] },
    { name: 'Colecao de qualidade', category: category('DevOps'), description: 'Quatro skills independentes para um fluxo de desenvolvimento confiavel.', tags: ['qualidade', 'colecao'], color: '#52c41a' as const,
      skills: [
        { name: 'Revisar alteracoes', category: category('Geral'), description: 'Revise uma alteracao antes de concluir a tarefa.', steps: ['Confira os requisitos.', 'Revise os casos limite.', 'Valide o comportamento com testes.'] },
        { name: 'Organizar modulos', category: category('Arquitetura'), description: 'Organize modulos quando uma funcionalidade crescer.', steps: ['Agrupe responsabilidades relacionadas.', 'Defina interfaces claras.', 'Preserve o comportamento existente.'] },
        { name: 'Preparar commit', category: category('Git'), description: 'Prepare um commit pequeno e verificavel.', steps: ['Revise o diff.', 'Nao inclua credenciais.', 'Escreva uma mensagem objetiva.'] },
        { name: 'Validar pipeline', category: category('DevOps'), description: 'Valide o pipeline antes de integrar uma alteracao.', steps: ['Execute lint, testes e build.', 'Exiba falhas de forma explicita.', 'Mantenha etapas reproduziveis.'] }
      ] },
    { name: 'Publicacao e descoberta', category: category('SEO'), description: 'Duas skills para preparar o conteudo e versionar a entrega.', tags: ['seo', 'publicacao'], color: '#fa8c16' as const,
      skills: [
        { name: 'Revisar SEO', category: category('SEO'), description: 'Revise a descoberta de uma pagina antes de publicar.', steps: ['Defina titulo e descricao claros.', 'Use cabecalhos semanticos.', 'Confira links e URLs.'] },
        { name: 'Versionar entrega', category: category('Git'), description: 'Versione uma entrega pronta para publicacao.', steps: ['Confirme os testes.', 'Revise os arquivos da entrega.', 'Registre a versao e as alteracoes.'] }
      ] },
    { name: 'Meu proximo conjunto', category: category('Geral'), description: 'Card vazio, pronto para receber novas skills ou skills existentes.', tags: ['planejamento', 'vazio'], color: '#8c8c8c' as const, skills: [] }
  ]
  const skills: Array<{ skill: Skill; content: string }> = []
  const cards = definitions.map(definition => {
    const skillIds = definition.skills.map(item => {
      const skill: Skill = {
        id: randomBytes(16).toString('hex'), name: item.name, category: item.category,
        description: item.description, agents: ['GitHub Copilot', 'Antigravity'],
        status: 'allowed', tags: [skillSlug(item.category), 'exemplo'],
        filePath: uniqueSkillFilePath(item.name, skills.map(entry => entry.skill.filePath))
      }
      const content = `---\nname: ${skillSlug(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n# ${skill.name}\n\n## Quando usar\n\n${skill.description}\n\n## Procedimento\n\n${item.steps.map(step => `- ${step}`).join('\n')}\n`
      skills.push({ skill, content })
      return skill.id
    })
    return {
      id: randomBytes(16).toString('hex'), name: definition.name, category: definition.category,
      description: definition.description, tags: definition.tags,
      agents: ['GitHub Copilot', 'Antigravity'], status: 'allowed' as const,
      cardColor: definition.color, skillIds
    }
  })
  return { cards, skills }
}

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
    status: 'allowed',
    tags: ['ts', 'patterns'],
    markdown: '## Diretrizes\n\n- Separe dominio, aplicacao e infraestrutura.\n- Adicione as instrucoes desta skill ao contexto.\n- Revise o conteudo antes de validar.'
  },
  {
    name: 'Git Flow & Boas Práticas',
    category: 'Git',
    description: 'Diretrizes de ramificação, commits e versionamento.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'allowed',
    tags: ['git', 'workflow'],
    markdown: '## Diretrizes\n\n- Use branches curtas e com nomes descritivos.\n- Escreva commits pequenos e objetivos.\n- Integre por pull request com revisao.'
  },
  {
    name: 'Integração Contínua (CI)',
    category: 'DevOps',
    description: 'Pipelines de integração contínua consistentes e seguros.',
    agents: ['GitHub Copilot'],
    status: 'allowed',
    tags: ['ci', 'actions'],
    markdown: '## Diretrizes\n\n- Execute lint, testes e build em cada alteracao.\n- Mantenha etapas reproduziveis e com falhas visiveis.\n- Armazene credenciais em secrets do ambiente.'
  },
  {
    name: 'Padronização de API REST',
    category: 'API',
    description: 'Boas práticas para definição de contratos e endpoints.',
    agents: ['Antigravity'],
    status: 'allowed',
    tags: ['api', 'rest'],
    aliases: ['REST API'],
    markdown: '## Diretrizes\n\n- Defina recursos e contratos HTTP consistentes.\n- Valide entradas e documente respostas e erros.\n- Mantenha compatibilidade entre versões.'
  },
  {
    name: 'Segurança da Informação',
    category: 'Segurança',
    description: 'Práticas para proteger aplicações, dados e usuários.',
    agents: ['GitHub Copilot', 'Antigravity'],
    status: 'allowed',
    tags: ['security', 'compliance'],
    markdown: '## Diretrizes\n\n- Minimize a coleta e exposicao de dados.\n- Valide entradas e proteja credenciais.\n- Revise dependencias e controles de acesso.'
  },
  {
    name: 'SEO Optimization',
    category: 'SEO',
    description: 'Técnicas on-page e off-page para melhorar a descoberta.',
    agents: ['Antigravity'],
    status: 'allowed',
    tags: ['seo', 'metadata'],
    markdown: '## Diretrizes\n\n- Use titulos, descricoes e URLs claros.\n- Estruture o conteudo com cabecalhos semanticos.\n- Adicione metadados e dados estruturados relevantes.'
  },
  {
    name: 'Testes Unitários com Vitest',
    category: 'Testes',
    description: 'Escreva testes de unidade claros, rápidos e confiáveis.',
    agents: ['GitHub Copilot'],
    status: 'allowed',
    tags: ['testing', 'vitest'],
    markdown: '## Diretrizes\n\n- Teste comportamento observavel e casos limite.\n- Mantenha cada teste independente e deterministico.\n- Use nomes que expliquem o resultado esperado.'
  }
]

export function createDocumentedExamples(): Array<{ skill: Skill; content: string }> {
  const usedPaths: string[] = []
  return examples.map(({ markdown, aliases: _aliases, ...metadata }) => {
    const skill: Skill = {
      ...metadata,
      id: randomBytes(16).toString('hex'),
      filePath: uniqueSkillFilePath(metadata.name, usedPaths)
    }
    usedPaths.push(skill.filePath)
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
      toCreate.push({
        ...example,
        skill: {
          ...example.skill,
          filePath: uniqueSkillFilePath(example.skill.name, [
            ...skills.map(skill => skill.filePath),
            ...toCreate.map(item => item.skill.filePath)
          ])
        }
      })
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
