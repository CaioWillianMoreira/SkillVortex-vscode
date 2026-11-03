import { z } from 'zod'

const unique = (values: string[]) => new Set(values).size === values.length
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
const names = z.array(z.string().trim().min(1).max(60)).refine(unique)
export const skillSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(60),
  description: z.string().max(1000),
  filePath: z.string().regex(/^skills\/[a-zA-Z0-9_-]+\.md$/),
  agents: z.array(z.string()),
  status: z.enum(['validated', 'pending', 'blocked']),
  tags: z.array(z.string()),
  originPath: z.string().optional()
})
export type Skill = z.infer<typeof skillSchema>
export const catalogSchema = z.object({
  version: z.literal(1),
  categories: names,
  skills: z.array(skillSchema).max(10000)
}).superRefine((catalog, context) => {
  if (!unique(catalog.skills.map(item => item.id)) ||
      !unique(catalog.skills.map(item => item.filePath))) {
    context.addIssue({ code: 'custom', message: 'IDs ou arquivos duplicados no catalogo.' })
  }
  if (catalog.skills.some(item => !catalog.categories.includes(item.category))) {
    context.addIssue({ code: 'custom', message: 'Categoria ausente do catalogo.' })
  }
})
export const projectsSchema = z.object({
  version: z.literal(1),
  activeProject: z.string().nullable(),
  projects: z.array(z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    sourcePath: z.string().optional(),
    skillIds: z.array(z.string()).refine(unique)
  })).max(10000)
}).superRefine((data, context) => {
  if (!unique(data.projects.map(project => project.id)) ||
      (data.activeProject !== null && !data.projects.some(p => p.id === data.activeProject))) {
    context.addIssue({ code: 'custom', message: 'Projetos ou projeto ativo invalidos.' })
  }
})
export type Catalog = z.infer<typeof catalogSchema>
export type Projects = z.infer<typeof projectsSchema>
export interface VaultData { catalog: Catalog; projects: Projects }

export function validateVault(catalog: unknown, projects: unknown): VaultData {
  const data = { catalog: catalogSchema.parse(catalog), projects: projectsSchema.parse(projects) }
  const available = new Set(data.catalog.skills.filter(s => s.status !== 'blocked').map(s => s.id))
  if (data.projects.projects.some(p => p.skillIds.some(id => !available.has(id)))) {
    throw new Error('Vinculo aponta para skill ausente ou bloqueada.')
  }
  return data
}

export function emptyVault(): VaultData {
  return {
    catalog: { version: 1, categories: ['Geral'], skills: [] },
    projects: { version: 1, activeProject: null, projects: [] }
  }
}
