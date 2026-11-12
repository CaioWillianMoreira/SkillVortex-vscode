import { z } from 'zod'
import { SKILL_CARD_COLORS } from './skill-colors'

const unique = (values: string[]) => new Set(values).size === values.length
export const titleKey = (name: string): string => name.trim().normalize('NFC').toLocaleLowerCase()
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
export function skillSlug(name: string): string {
  const slug = name.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug || 'skill'
}
export function uniqueSkillFilePath(name: string, existingPaths: Iterable<string>): string {
  const paths = new Set(existingPaths)
  const base = skillSlug(name)
  let slug = base
  let suffix = 2
  while (paths.has(`skills/${slug}.md`)) {
    const tail = `-${suffix++}`
    slug = `${base.slice(0, 64 - tail.length).replace(/-+$/g, '')}${tail}`
  }
  return `skills/${slug}.md`
}
const names = z.array(z.string().trim().min(1).max(60)).refine(unique)
export const skillAgentSchema = z.enum(['GitHub Copilot', 'Antigravity'])
export type SkillAgent = z.infer<typeof skillAgentSchema>
export const agentRoot = (agent: SkillAgent): '.github' | '.agents' =>
  agent === 'Antigravity' ? '.agents' : '.github'
export const deploymentAgent = (item: { agent?: SkillAgent }): SkillAgent =>
  item.agent ?? 'GitHub Copilot'
export const agentFolderNames = [
  '.github', '.agents', '.agent', '.copilot', '.claude', '.cursor', '.codex', '.gemini',
  '.windsurf', '.roo', '.kilocode', '.continue', '.opencode'
]
const agentDirectorySchema = z.string().regex(/^\.[a-zA-Z0-9_-]+$/)
  .refine(value => !['.git', '.skillvortex', '.vscode'].includes(value.toLowerCase()))
export const publicationPathSchema = z.string().trim().max(1000).refine(value => {
  const parts = value.split('/')
  return parts.length >= 2 && /^\.[a-zA-Z0-9_-]+$/.test(parts[0]) &&
    !['.git', '.skillvortex', '.vscode'].includes(parts[0].toLowerCase()) &&
    parts.every(part => Boolean(part) && part !== '.' && part !== '..' && !/[\\:\x00-\x1f\x7f]/.test(part)) &&
    /\.md$/i.test(parts[parts.length - 1])
}, 'Informe um caminho .md relativo a pasta do agente, como .agents/skills/teste/11-teste.md, sem .. ou caminho absoluto.')

export function importedPublicationPath(originPath?: string): string | undefined {
  if (!originPath) return undefined
  const parts = originPath.replace(/\\/g, '/').split('/')
  let index = parts.findIndex(part => agentFolderNames.includes(part.toLowerCase()))
  if (index < 0) {
    index = parts.map((part, position) => position < parts.length - 1 &&
      /^\.[a-zA-Z0-9_-]+$/.test(part) && !['.git', '.skillvortex', '.vscode'].includes(part.toLowerCase())).lastIndexOf(true)
  }
  if (index < 0) return undefined
  return publicationPathSchema.parse(parts.slice(index).join('/'))
}
type DeploymentLocation = {
  agent?: SkillAgent; agentDirectory?: string; relativePath?: string; directory: string
}
export function deploymentRoot(item: Omit<DeploymentLocation, 'directory'>): string {
  const root = item.relativePath ? publicationPathSchema.parse(item.relativePath).split('/')[0]
    : item.agentDirectory ? agentDirectorySchema.parse(item.agentDirectory) : agentRoot(deploymentAgent(item))
  if (['.github', '.agents', '.agent'].includes(root) &&
      (deploymentAgent(item) === 'GitHub Copilot') !== (root === '.github')) {
    throw new Error('Pasta de publicacao incompativel com o agente da skill.')
  }
  return root
}
export const deploymentPath = (item: DeploymentLocation): string =>
  item.relativePath ? publicationPathSchema.parse(item.relativePath)
    : `${deploymentRoot(item)}/skills/${item.directory}/SKILL.md`
export const skillPublicationPath = (skill: { publicationPath?: string; originPath?: string }): string | undefined =>
  skill.publicationPath ?? importedPublicationPath(skill.originPath)
export function publicationPathForAgent(skill: Skill, agent: SkillAgent): string | undefined {
  const path = skillPublicationPath(skill)
  if (!path) return undefined
  const [root, ...parts] = publicationPathSchema.parse(path).split('/')
  const owner: SkillAgent = root === '.agents' || root === '.agent' ? 'Antigravity'
    : root === '.github' ? 'GitHub Copilot'
      : skill.agents.includes('Antigravity') && !skill.agents.includes('GitHub Copilot') ? 'Antigravity' : 'GitHub Copilot'
  return [agent === owner ? root : agentRoot(agent), ...parts].join('/')
}
export const agentSkillKey = (skillId: string, agent: SkillAgent): string => `${agent}:${skillId}`
const statusSchema = z.preprocess(value => value === 'pending' || value === 'validated' ? 'allowed' : value,
  z.enum(['allowed', 'blocked']))
export const skillSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(1000),
  filePath: z.string().regex(/^skills\/[a-zA-Z0-9_-]+\.md$/),
  agents: z.array(z.string()),
  status: statusSchema,
  tags: z.array(z.string()),
  cardColor: z.enum(SKILL_CARD_COLORS).optional(),
  archived: z.boolean().optional(),
  originPath: z.string().optional(),
  publicationPath: publicationPathSchema.optional(),
  publishedFolders: z.array(z.object({
    projectId: z.string().min(1),
    projectPath: z.string().min(1),
    directory: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    owned: z.boolean(),
    agent: skillAgentSchema.optional(),
    agentDirectory: agentDirectorySchema.optional(),
    relativePath: publicationPathSchema.optional(),
    marker: z.string().regex(/^[a-f0-9]{32}$/).optional()
  })).max(10000).optional()
})
export type Skill = z.infer<typeof skillSchema>
export const skillRegistrationSchema = skillSchema.pick({
  name: true, category: true, description: true, status: true, publicationPath: true
}).extend({
  executionName: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use letras minusculas, numeros e hifens no nome de execucao, sem /.').max(64).optional(),
  name: z.string().trim().min(1, 'Informe o titulo da skill.').max(100),
  category: z.string().trim().min(1, 'Informe a categoria da skill.').max(60),
  description: z.string().trim().min(1, 'Informe a descricao da skill.').max(1000),
  tags: z.array(z.string().trim().min(1).max(60))
    .min(1, 'Informe pelo menos uma etiqueta.').max(100),
  agents: z.array(z.string().trim().min(1).max(60))
    .max(20),
  content: z.string().max(2 * 1024 * 1024)
    .refine(value => Boolean(value.trim()), 'Informe o conteudo Markdown.')
})
export const collectionSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(60),
  archived: z.boolean().optional(),
  skillIds: z.array(z.string()).max(10000).refine(unique),
  disabledSkillIds: z.array(z.string()).max(10000).refine(unique).optional(),
  category: skillSchema.shape.category.optional(),
  description: skillSchema.shape.description.optional(),
  agents: skillSchema.shape.agents.optional(),
  tags: skillSchema.shape.tags.optional(),
  status: skillSchema.shape.status.optional(),
  cardColor: skillSchema.shape.cardColor.optional()
})
export const catalogSchema = z.object({
  version: z.literal(1),
  categories: names,
  collections: z.array(collectionSchema).max(10000).optional(),
  skills: z.array(skillSchema).max(10000)
}).superRefine((catalog, context) => {
  const titles = new Set<string>()
  for (const item of [...catalog.skills, ...(catalog.collections ?? [])]) {
    const key = titleKey(item.name)
    if (titles.has(key)) {
      context.addIssue({ code: 'custom', message: `Ja existe uma skill ou card com o titulo "${item.name.trim()}". Use um titulo unico.` })
    }
    titles.add(key)
  }
  if (!unique(catalog.skills.map(item => item.id)) ||
      !unique(catalog.skills.map(item => item.filePath))) {
    context.addIssue({ code: 'custom', message: 'IDs ou arquivos duplicados no catalogo.' })
  }
  if (catalog.skills.some(item => !catalog.categories.includes(item.category))) {
    context.addIssue({ code: 'custom', message: 'Categoria ausente do catalogo.' })
  }
  if (catalog.collections?.some(item => item.category && !catalog.categories.includes(item.category))) {
    context.addIssue({ code: 'custom', message: 'Categoria do card ausente do catalogo.' })
  }
  const collections = catalog.collections ?? []
  if (collections.some(item => item.disabledSkillIds?.some(id => !item.skillIds.includes(id)))) {
    context.addIssue({ code: 'custom', message: 'Selecao de skills contem membros ausentes do card.' })
  }
  if (!unique(collections.flatMap(item => item.skillIds))) {
    context.addIssue({ code: 'custom', message: 'Cada skill pode pertencer a apenas um card. Remova os vinculos repetidos.' })
  }
  if (!unique(collections.map(item => item.id)) ||
      !unique(collections.map(item => item.name.toLocaleLowerCase())) ||
      collections.some(item => item.skillIds.some(id => !catalog.skills.some(skill => skill.id === id)))) {
    context.addIssue({ code: 'custom', message: 'Colecoes duplicadas ou com skills ausentes.' })
  }
})
export const projectsSchema = z.object({
  version: z.literal(1),
  activeProject: z.string().nullable(),
  projects: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    sourcePath: z.string().optional(),
    sharedPublication: z.boolean().optional(),
    collectionBindings: z.array(z.object({
      collectionId: z.string(), agent: skillAgentSchema
    })).refine(items => unique(items.map(item => agentSkillKey(item.collectionId, item.agent)))).optional(),
    skillIds: z.array(z.string()).refine(unique),
    agentBindings: z.array(z.object({
      skillId: z.string(), agent: skillAgentSchema
    })).refine(items => unique(items.map(item => agentSkillKey(item.skillId, item.agent)))).optional(),
    deployedSkills: z.array(z.object({
      skillId: z.string(),
      agent: skillAgentSchema.optional(),
      agentDirectory: agentDirectorySchema.optional(),
      relativePath: publicationPathSchema.optional(),
      directory: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/)
    })).refine(items => unique(items.map(item => agentSkillKey(item.skillId, deploymentAgent(item)))) &&
      unique(items.map(item => {
        deploymentRoot(item)
        return deploymentPath(item)
      }))).optional()
  })).max(10000)
}).superRefine((data, context) => {
  if (!unique(data.projects.map(project => project.id)) ||
      (data.activeProject !== null && !data.projects.some(p => p.id === data.activeProject))) {
    context.addIssue({ code: 'custom', message: 'Projetos ou projeto ativo invalidos.' })
  }
})
export type Catalog = z.infer<typeof catalogSchema>
export function assertUniqueTitle(catalog: Catalog, name: string, except?: { kind: 'skill' | 'card'; id: string }): void {
  const key = titleKey(name)
  if (catalog.skills.some(item => !(except?.kind === 'skill' && except.id === item.id) && titleKey(item.name) === key) ||
      catalog.collections?.some(item => !(except?.kind === 'card' && except.id === item.id) && titleKey(item.name) === key)) {
    throw new Error(`Ja existe uma skill ou card com o titulo "${name.trim()}". Use um titulo unico.`)
  }
}
export type SkillCard = {
  id: string; name: string; category: string; description: string;
  agents: string[]; tags: string[]; status: Skill['status']; cardColor?: Skill['cardColor']; archived?: boolean;
  skillIds: string[]; disabledSkillIds?: string[]; standaloneSkillId?: string
}
export function skillCards(catalog: Catalog): SkillCard[] {
  const collections = catalog.collections ?? []
  const grouped = new Set(collections.flatMap(item => item.skillIds))
  return [
    ...collections.map(item => {
      const first = catalog.skills.find(skill => item.skillIds.includes(skill.id))
      return {
        ...item, category: item.category ?? first?.category ?? catalog.categories[0] ?? 'Geral',
        description: item.description ?? first?.description ?? 'Conjunto de skills para usar no projeto.',
        agents: item.agents ?? first?.agents ?? [],
        tags: item.tags ?? first?.tags ?? [], status: item.status ?? 'allowed' as const
      }
    }),
    ...catalog.skills.filter(skill => !grouped.has(skill.id)).map(skill => ({
      ...skill, skillIds: [skill.id], standaloneSkillId: skill.id
    }))
  ]
}
export type Projects = z.infer<typeof projectsSchema>
export type Project = Projects['projects'][number]
export function projectBindings(project: Project): Array<{ skillId: string; agent: SkillAgent }> {
  return project.agentBindings ?? project.skillIds.map(skillId => ({ skillId, agent: 'GitHub Copilot' }))
}
export function setProjectBindings(project: Project, bindings: ReturnType<typeof projectBindings>): void {
  project.agentBindings = bindings
  project.skillIds = [...new Set(bindings.map(item => item.skillId))]
}
export function isAgentLinked(project: Project, skillId: string, agent: SkillAgent): boolean {
  return projectBindings(project).some(item => item.skillId === skillId && item.agent === agent)
}
export function selectedSkillIds(card: { skillIds: string[]; disabledSkillIds?: string[] }): string[] {
  return card.skillIds.filter(id => !card.disabledSkillIds?.includes(id))
}
export function isCollectionLinked(project: Project, card: { id: string; skillIds: string[] }, agent: SkillAgent): boolean {
  return Boolean(project.collectionBindings?.some(item => item.collectionId === card.id && item.agent === agent)) ||
    card.skillIds.some(id => isAgentLinked(project, id, agent))
}
export function setCollectionLinked(project: Project, collectionId: string, agent: SkillAgent, enabled: boolean): void {
  const bindings = (project.collectionBindings ?? []).filter(item =>
    item.collectionId !== collectionId || item.agent !== agent)
  if (enabled) bindings.push({ collectionId, agent })
  project.collectionBindings = bindings
}
export function setSharedSkillPublication(project: Project, skillId: string, enabled: boolean,
  agents: readonly SkillAgent[] = ['Antigravity', 'GitHub Copilot']): void {
  const bindings = projectBindings(project).filter(item => item.skillId !== skillId)
  if (enabled) for (const agent of new Set(agents)) bindings.push({ skillId, agent })
  setProjectBindings(project, bindings)
  project.sharedPublication = true
}
export function removeSkillFromCollections(catalog: Catalog, skillId: string): void {
  for (const collection of catalog.collections ?? []) {
    collection.skillIds = collection.skillIds.filter(id => id !== skillId)
    if (collection.disabledSkillIds) collection.disabledSkillIds = collection.disabledSkillIds.filter(id => id !== skillId)
  }
}
export interface VaultData { catalog: Catalog; projects: Projects }

export function isSkillArchived(catalog: Catalog, id: string): boolean {
  return Boolean(catalog.skills.find(skill => skill.id === id)?.archived ||
    catalog.collections?.some(card => card.archived && card.skillIds.includes(id)))
}

export function setCardArchived(data: VaultData, kind: 'skill' | 'collection', id: string, archived: boolean): void {
  const item = kind === 'skill' ? data.catalog.skills.find(skill => skill.id === id)
    : data.catalog.collections?.find(card => card.id === id)
  if (!item) throw new Error('Card nao encontrado.')
  const ids = kind === 'skill' ? [id] : data.catalog.collections?.find(card => card.id === id)?.skillIds ?? []
  if (archived && data.projects.projects.some(project =>
    ids.some(skillId => project.skillIds.includes(skillId) ||
      project.agentBindings?.some(binding => binding.skillId === skillId) ||
      project.deployedSkills?.some(deployed => deployed.skillId === skillId)) ||
    (kind === 'collection' && project.collectionBindings?.some(binding => binding.collectionId === id)))) {
    throw new Error('Desative o card em todos os projetos antes de arquivar.')
  }
  item.archived = archived
}

export function validateVault(catalog: unknown, projects: unknown): VaultData {
  const legacyCatalog = typeof catalog === 'object' && catalog !== null && 'skills' in catalog &&
      Array.isArray(catalog.skills)
    ? {
        ...catalog,
        skills: catalog.skills.map((skill: unknown) => {
          if (typeof skill !== 'object' || skill === null || !('description' in skill) ||
              typeof skill.description !== 'string' || skill.description.trim()) return skill
          const name = 'name' in skill && typeof skill.name === 'string' ? skill.name : 'Skill'
          return { ...skill, description: `Skill importada sem descricao; edite este campo (${name}).` }
        })
      }
    : catalog
  const data = { catalog: catalogSchema.parse(legacyCatalog), projects: projectsSchema.parse(projects) }
  const available = new Set(data.catalog.skills.filter(s => s.status !== 'blocked').map(s => s.id))
  if (data.projects.projects.some(p => p.skillIds.some(id => !available.has(id)))) {
    throw new Error('Vinculo aponta para skill ausente ou bloqueada.')
  }
  for (const project of data.projects.projects) {
    if (project.collectionBindings?.some(binding =>
      !data.catalog.collections?.some(card => card.id === binding.collectionId))) {
      throw new Error('Vinculo aponta para card ausente.')
    }
    if (project.agentBindings && (!unique(project.skillIds) ||
        project.agentBindings.some(item => !project.skillIds.includes(item.skillId)) ||
        project.skillIds.some(id => !project.agentBindings!.some(item => item.skillId === id)))) {
      throw new Error('Vinculos de agentes inconsistentes com as skills do projeto.')
    }
  }
  return data
}

export function emptyVault(): VaultData {
  return {
    catalog: { version: 1, categories: ['Geral'], skills: [] },
    projects: { version: 1, activeProject: null, projects: [] }
  }
}
