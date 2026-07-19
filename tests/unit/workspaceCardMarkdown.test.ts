import { describe, expect, it } from 'vitest'
import { boardCardPreview } from '../../src/renderer/utils/workspaceCardMarkdown'

describe('boardCardPreview', () => {
  it('preserves short card content', () => {
    expect(boardCardPreview('# Title\n\nShort body')).toBe('# Title\n\nShort body')
  })

  it('bounds long Markdown before it reaches the board DOM', () => {
    const content = Array.from({ length: 80 }, (_, index) => `- row ${index} ${'x'.repeat(80)}`).join('\n')
    const preview = boardCardPreview(content)

    expect(preview).toContain('- row 0')
    expect(preview).not.toContain('- row 79')
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.split('\n').length).toBeLessThanOrEqual(30)
    expect(preview.length).toBeLessThanOrEqual(1810)
  })
})
