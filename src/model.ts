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
    marker: z.string().regex(/^[a-f0-9]{32}$/).optional()
  })).max(10000).optional()
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
    skillIds: z.array(z.string()).refine(unique),
    deployedSkills: z.array(z.object({
      skillId: z.string(),
      directory: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      sourceHash: z.string().regex(/^[a-f0-9]{64}$/)
    })).refine(items => unique(items.map(item => item.skillId)) &&
      unique(items.map(item => item.directory))).optional()
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
  return data
}

export function emptyVault(): VaultData {
  return {
    catalog: { version: 1, categories: ['Geral'], skills: [] },
    projects: { version: 1, activeProject: null, projects: [] }
  }
}
