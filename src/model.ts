import { z } from 'zod'
import { SKILL_CARD_COLORS } from './skill-colors'

const unique = (values: string[]) => new Set(values).size === values.length
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
export function deploymentRoot(item: { agent?: SkillAgent; agentDirectory?: '.github' | '.agents' | '.agent' }): '.github' | '.agents' | '.agent' {
  const root = item.agentDirectory ?? agentRoot(deploymentAgent(item))
  if ((deploymentAgent(item) === 'GitHub Copilot') !== (root === '.github')) {
    throw new Error('Pasta de publicacao incompativel com o agente da skill.')
  }
  return root
}
export const agentSkillKey = (skillId: string, agent: SkillAgent): string => `${agent}:${skillId}`
export const skillSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(1000),
  filePath: z.string().regex(/^skills\/[a-zA-Z0-9_-]+\.md$/),
  agents: z.array(z.string()),
  status: z.enum(['validated', 'pending', 'blocked']),
  tags: z.array(z.string()),
  cardColor: z.enum(SKILL_CARD_COLORS).optional(),
  originPath: z.string().optional(),
  publishedFolders: z.array(z.object({
    projectId: z.string().min(1),
    projectPath: z.string().min(1),
    directory: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    owned: z.boolean(),
    agent: skillAgentSchema.optional(),
    agentDirectory: z.enum(['.github', '.agents', '.agent']).optional(),
    marker: z.string().regex(/^[a-f0-9]{32}$/).optional()
  })).max(10000).optional()
})
export type Skill = z.infer<typeof skillSchema>
export const skillRegistrationSchema = skillSchema.pick({
  name: true, category: true, description: true, status: true
}).extend({
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
  skillIds: z.array(z.string()).max(10000).refine(unique),
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
    skillIds: z.array(z.string()).refine(unique),
    agentBindings: z.array(z.object({
      skillId: z.string(), agent: skillAgentSchema
    })).refine(items => unique(items.map(item => agentSkillKey(item.skillId, item.agent)))).optional(),
    deployedSkills: z.array(z.object({
      skillId: z.string(),
      agent: skillAgentSchema.optional(),
      agentDirectory: z.enum(['.github', '.agents', '.agent']).optional(),
      directory: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/)
    })).refine(items => unique(items.map(item => agentSkillKey(item.skillId, deploymentAgent(item)))) &&
      unique(items.map(item => `${deploymentRoot(item)}:${item.directory}`))).optional()
  })).max(10000)
}).superRefine((data, context) => {
  if (!unique(data.projects.map(project => project.id)) ||
      (data.activeProject !== null && !data.projects.some(p => p.id === data.activeProject))) {
    context.addIssue({ code: 'custom', message: 'Projetos ou projeto ativo invalidos.' })
  }
})
export type Catalog = z.infer<typeof catalogSchema>
export type SkillCard = {
  id: string; name: string; category: string; description: string;
  agents: string[]; tags: string[]; status: Skill['status']; cardColor?: Skill['cardColor'];
  skillIds: string[]; standaloneSkillId?: string
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
        tags: item.tags ?? first?.tags ?? [], status: item.status ?? 'pending' as const
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
  }
}
export interface VaultData { catalog: Catalog; projects: Projects }

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
