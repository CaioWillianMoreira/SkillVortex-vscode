const CATEGORY_COLORS = ['#9b59b6', '#ff4d4f', '#13c2c2', '#52c41a', '#fa8c16', '#1677ff'] as const

export const SKILL_CARD_COLORS = [
  ...CATEGORY_COLORS, '#eb2f96', '#fadb14', '#a0d911', '#8c8c8c'
] as const

export type SkillCardColor = typeof SKILL_CARD_COLORS[number]

export const SKILL_CARD_COLOR_LABELS: Record<SkillCardColor, string> = {
  '#9b59b6': 'Roxo',
  '#ff4d4f': 'Vermelho',
  '#13c2c2': 'Ciano',
  '#52c41a': 'Verde',
  '#fa8c16': 'Laranja',
  '#1677ff': 'Azul',
  '#eb2f96': 'Rosa',
  '#fadb14': 'Amarelo',
  '#a0d911': 'Lima',
  '#8c8c8c': 'Cinza'
}

export function isSkillCardColor(value: unknown): value is SkillCardColor {
  return typeof value === 'string' && SKILL_CARD_COLORS.some(color => color === value)
}

export function categoryColor(category: string): SkillCardColor {
  let hash = 0
  for (const character of category) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return CATEGORY_COLORS[hash % CATEGORY_COLORS.length]
}

export function skillCardTextColor(color: SkillCardColor): '#000000' | '#ffffff' {
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
