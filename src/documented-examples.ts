import { randomBytes } from 'node:crypto'
import { skillSlug, uniqueSkillFilePath, type Catalog, type Skill } from './model'

export function createCardExamples(categories: string[]): {
  cards: NonNullable<Catalog['collections']>; skills: Array<{ skill: Skill; content: string }>
} {
  if (!categories.length) throw new Error('Crie pelo menos uma categoria antes de carregar exemplos.')
  const category = (preferred: string) => categories.includes(preferred) ? preferred : categories[0]
  const definitions = [
    { name: 'Acessibilidade', category: category('Acessibilidade'), description: 'Duas skills para revisar teclado, foco, formularios e alternativas acessiveis.', tags: ['acessibilidade', 'wcag'], color: '#1677ff' as const,
      skills: [
        { name: 'Revisar teclado e foco', category: category('Acessibilidade'), description: 'Use ao criar ou alterar controles, navegacao ou dialogos para revisar acesso por teclado.', steps: ['Identifique os fluxos e controles afetados; prefira button para acoes e a com href para navegacao.', 'Percorra o fluxo com Tab, Shift+Tab e teclas nativas dos controles, sem armadilhas de teclado.', 'Mantenha ordem de foco coerente e indicador visivel. Ao fechar dialogos, restaure o foco ao acionador quando adequado.', 'Corrija barreiras e registre o que foi testado manualmente; teste automatizado isolado nao comprova conformidade WCAG.'], validation: 'Concluir o fluxo principal sem mouse, verificando foco ao abrir e fechar dialogos e ausencia de perda de acesso.', sources: ['https://www.w3.org/WAI/WCAG22/quickref/'] },
        { name: 'Revisar rotulos imagens e contraste', category: category('Acessibilidade'), description: 'Use ao criar formularios e conteudo visual para revisar nomes acessiveis, alternativas e contraste.', steps: ['Associe label e campo por for/id; nao use placeholder como unico rotulo.', 'Descreva erros em texto e associe instrucoes aos campos. Preserve nome, funcao e estado acessiveis.', 'Escreva alt equivalente para imagens informativas e alt vazio para imagens decorativas.', 'Meça contraste de texto: 4,5:1 comum e 3:1 grande (18 pt ou 14 pt em negrito), observando as excecoes WCAG, como logotipos e controles inativos.'], validation: 'Verificar nomes e erros com leitor de tela e medir contraste; documentar pendencias sem afirmar conformidade completa.', sources: ['https://www.w3.org/WAI/tutorials/forms/labels/', 'https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html'] }
      ] },
    { name: 'HTML e CSS', category: category('Geral'), description: 'Tres skills para estrutura semantica, responsividade e manutencao de estilos.', tags: ['html', 'css'], color: '#52c41a' as const,
      skills: [
        { name: 'Estruturar HTML semantico', category: category('Geral'), description: 'Use ao criar ou refatorar paginas para representar o significado do conteudo em HTML.', steps: ['Mapeie navegacao, conteudo principal e secoes antes de escolher tags.', 'Use main, nav, header, footer e headings conforme sua funcao, nao pela aparencia.', 'Use links para destinos e botoes para acoes; mantenha ordem de leitura compreensivel sem CSS.', 'Preserve o comportamento existente e valide o HTML com as ferramentas do projeto.'], validation: 'Conferir hierarquia de titulos, landmarks, controles nativos e navegacao por teclado.', sources: ['https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Structuring_documents'] },
        { name: 'Construir layout responsivo', category: category('Geral'), description: 'Use ao implementar ou corrigir layouts para telas estreitas, largas e conteudo variavel.', steps: ['Inspecione os tamanhos e componentes existentes antes de alterar o layout.', 'Use dimensoes fluidas, Flexbox ou Grid e pontos de quebra orientados pelo conteudo.', 'Limite imagens ao container mantendo proporcao; evite larguras fixas que causem overflow.', 'Teste texto longo, zoom e diferentes larguras sem ocultar conteudo para mascarar problemas.'], validation: 'Conferir celular e desktop, zoom e textos longos sem sobreposicao ou rolagem horizontal desnecessaria.', sources: ['https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Responsive_Design'] },
        { name: 'Organizar e revisar CSS', category: category('Geral'), description: 'Use ao adicionar ou refatorar estilos para preservar consistencia e facilitar manutencao.', steps: ['Identifique tokens, componentes e convencoes CSS existentes; reutilize-os antes de criar estilos.', 'Mantenha apresentacao no CSS e significado no HTML; evite substituir semantica por estilos.', 'Agrupe regras por componente e remova somente duplicacoes relacionadas a tarefa.', 'Revise cascata, especificidade e estados de foco, erro e desabilitado nos navegadores suportados.'], validation: 'Comparar estados e larguras antes/depois e executar lint e build existentes, registrando comandos e limitacoes.', sources: ['https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/Organizing'] }
      ] },
    { name: 'SEO', category: category('SEO'), description: 'Uma skill para revisar descoberta e indexacao de paginas publicas.', tags: ['seo', 'indexacao'], color: '#9b59b6' as const,
      skills: [{ name: 'Revisar SEO de paginas publicas', category: category('SEO'), description: 'Use antes de publicar ou alterar paginas publicas que devem ser encontradas em buscadores.', steps: ['Confirme quais paginas devem ser publicas e indexaveis; conteudo privado exige controle de acesso.', 'Revise title especifico, descricao relevante, headings e conteudo util ao usuario.', 'Confira URLs descritivas, links a com href e acesso aos recursos necessarios a renderizacao.', 'Revise canonical em duplicacoes e sitemap quando aplicavel. Nao use robots.txt como garantia de desindexacao.', 'Inspecione a URL no Search Console quando houver acesso; nao prometa indexacao ou posicao nos resultados.'], validation: 'Registrar verificacoes de metadados, links, resposta HTTP e pagina renderizada, com pendencias e ferramentas usadas.', sources: ['https://developers.google.com/search/docs/fundamentals/seo-starter-guide'] }] },
    { name: 'Testes', category: category('Testes'), description: 'Uma skill para cenarios confiaveis de interface e regressao.', tags: ['testes', 'qualidade'], color: '#fa8c16' as const,
      skills: [{ name: 'Criar testes de comportamento e regressao', category: category('Testes'), description: 'Use ao implementar funcionalidades ou corrigir defeitos para testar comportamento observavel com dados controlados.', steps: ['Leia os criterios de aceite e os testes existentes; liste sucesso, limites, erros e permissoes relevantes.', 'Isole dados e estado de cada teste, sem depender de ordem ou dados pessoais de producao.', 'Em testes de interface, prefira papel, nome acessivel e rotulo; use espera automatica e assercoes que aguardam condicoes em vez de pausas fixas.', 'Simule servicos externos fora do controle da equipe e cubra integracoes proprias em ambiente apropriado.', 'Para defeitos, adicione uma regressao que reproduza o problema. Execute o menor conjunto relevante e registre resultado e limitacoes.'], validation: 'Executar isoladamente e junto dos testes relacionados; investigar intermitencias sem esconder falhas com repeticoes indiscriminadas.', sources: ['https://playwright.dev/docs/best-practices'] }] }
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
      const content = `---\nname: ${skillSlug(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n# ${skill.name}\n\n## Quando usar\n\n${skill.description}\n\n## Procedimento\n\n${item.steps.map(step => `- ${step}`).join('\n')}\n\n## Validacao\n\n${item.validation}\n\n## Fontes\n\n${item.sources.map(url => `- <${url}>`).join('\n')}\n`
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
