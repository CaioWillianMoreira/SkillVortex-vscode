import { expect, test } from '@jest/globals'
import { skillSchema } from '../src/model'
import {
  categoryColor, isSkillCardColor, SKILL_CARD_COLOR_LABELS, SKILL_CARD_COLORS, skillCardTextColor
} from '../src/skill-colors'

const skill = {
  id: 'test', name: 'Test', category: 'Geral', description: 'Test description',
  filePath: 'skills/test.md', agents: [], status: 'pending', tags: []
}

test('offers exactly ten unique named colors and validates them in skill metadata', () => {
  expect(SKILL_CARD_COLORS).toHaveLength(10)
  expect(new Set(SKILL_CARD_COLORS).size).toBe(10)
  expect(Object.keys(SKILL_CARD_COLOR_LABELS)).toHaveLength(10)
  for (const cardColor of SKILL_CARD_COLORS) {
    expect(SKILL_CARD_COLOR_LABELS[cardColor]).toBeTruthy()
    expect(isSkillCardColor(cardColor)).toBe(true)
    expect(skillSchema.parse({ ...skill, cardColor }).cardColor).toBe(cardColor)
  }
  for (const cardColor of ['#abcdef', 'red', '', null]) {
    expect(isSkillCardColor(cardColor)).toBe(false)
    expect(skillSchema.safeParse({ ...skill, cardColor }).success).toBe(false)
  }
})

test('keeps legacy skills and their automatic category colors unchanged', () => {
  expect(skillSchema.parse(skill)).not.toHaveProperty('cardColor')
  expect(categoryColor('Geral')).toBe('#1677ff')
  expect(categoryColor('API')).toBe('#13c2c2')
  expect(categoryColor('Arquitetura')).toBe('#52c41a')
  expect(categoryColor('Testes')).toBe('#13c2c2')
  expect(categoryColor('Segurança')).toBe('#52c41a')
})

test('uses readable text on every chosen category tag', () => {
  for (const color of SKILL_CARD_COLORS) {
    const linearChannels = [1, 3, 5].map(index => {
      const channel = parseInt(color.slice(index, index + 2), 16) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    const luminance = 0.2126 * linearChannels[0] +
      0.7152 * linearChannels[1] + 0.0722 * linearChannels[2]
    const contrast = skillCardTextColor(color) === '#000000'
      ? (luminance + 0.05) / 0.05
      : 1.05 / (luminance + 0.05)
    expect(contrast).toBeGreaterThanOrEqual(4.5)
  }
})
