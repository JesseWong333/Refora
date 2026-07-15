import { describe, it, expect } from 'vitest'
import {
  REMARK_PLUGINS,
  REHYPE_PLUGINS,
  urlTransform,
  createMarkdownComponents,
  MARKDOWN_COMPONENTS
} from '../../src/renderer/utils/markdown'

describe('markdown plugin exports', () => {
  it('exports non-empty remark and rehype plugin arrays', () => {
    expect(REMARK_PLUGINS.length).toBeGreaterThan(0)
    expect(REHYPE_PLUGINS.length).toBeGreaterThan(0)
  })
})

describe('urlTransform', () => {
  it('passes through refora:// urls untouched', () => {
    expect(urlTransform('refora://doc/abc')).toBe('refora://doc/abc')
  })

  it('defers to defaultUrlTransform for normal urls', () => {
    expect(urlTransform("https://example.com")).toBe("https://example.com")
  })
})

describe('createMarkdownComponents', () => {
  it('returns the base components when no overrides given', () => {
    const comps = createMarkdownComponents()
    expect(comps.pre).toBe(MARKDOWN_COMPONENTS.pre)
    expect(comps.a).toBe(MARKDOWN_COMPONENTS.a)
  })

  it('merges overrides over base components', () => {
    const customPre = () => null
    const comps = createMarkdownComponents({ pre: customPre })
    expect(comps.pre).toBe(customPre)
    expect(comps.a).toBe(MARKDOWN_COMPONENTS.a)
  })

  it('does not mutate the shared base components object', () => {
    const before = { ...MARKDOWN_COMPONENTS }
    createMarkdownComponents({ a: () => null })
    expect(MARKDOWN_COMPONENTS).toEqual(before)
  })
})
