import { z } from 'zod'
import { SKILL_CARD_COLORS } from './skill-colors'

export const mindFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.enum(SKILL_CARD_COLORS)
})
export const mindNoteInputSchema = z.object({
  title: z.string().trim().min(1, 'Informe o titulo da nota.').max(120),
  folderId: z.string().uuid(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50),
  links: z.array(z.string().uuid()).max(200),
  content: z.string().max(2 * 1024 * 1024)
})
export const mindNoteMetadataSchema = mindNoteInputSchema.omit({ content: true }).extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})
export type MindFolder = z.infer<typeof mindFolderSchema>
export type MindNoteInput = z.infer<typeof mindNoteInputSchema>
export type MindNote = z.infer<typeof mindNoteMetadataSchema> & { filePath: string; revision: string }
export interface MindCardsState {
  folders: MindFolder[]
  notes: MindNote[]
  revision: string | null
}
export interface MindNoteDocument {
  note: MindNote
  content: string
}
