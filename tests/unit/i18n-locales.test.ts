import { describe, it, expect } from 'vitest'
import en from '../../src/renderer/i18n/locales/en.json'
import zh from '../../src/renderer/i18n/locales/zh.json'

const NAMESPACES = [
  'sidebar',
  'topbar',
  'list',
  'detail',
  'settings',
  'common',
  'dialog'
] as const

describe('i18n locale files (master plan §8 namespaces)', () => {
  it('en.json has all namespaces', () => {
    for (const ns of NAMESPACES) {
      expect(en).toHaveProperty(ns)
    }
  })

  it('zh.json has all namespaces', () => {
    for (const ns of NAMESPACES) {
      expect(zh).toHaveProperty(ns)
    }
  })

  it('en and zh share the same keys in every namespace', () => {
    for (const ns of NAMESPACES) {
      const enKeys = Object.keys(en[ns]).sort()
      const zhKeys = Object.keys(zh[ns]).sort()
      expect(enKeys).toEqual(zhKeys)
    }
  })

  it('interpolation placeholders are preserved across languages', () => {
    expect(en.common.multiSelected).toContain('{{count}}')
    expect(zh.common.multiSelected).toContain('{{count}}')
    expect(en.dialog.duplicateWarning).toContain('{{name}}')
    expect(zh.dialog.duplicateWarning).toContain('{{name}}')
  })
})
