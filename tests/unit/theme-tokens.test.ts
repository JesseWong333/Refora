import { describe, it, expect, beforeEach } from 'vitest'
import {
  getPalette,
  getAntdTokenOverrides,
  injectThemeCssVars,
} from '../../src/renderer/theme/tokens'

const COLOR_TOKEN_KEYS = [
  'colorPrimary',
  'colorPrimaryHover',
  'colorBgLayout',
  'colorBgContainer',
  'colorBgElevated',
  'colorBgSpotlight',
  'colorText',
  'colorTextSecondary',
  'colorTextTertiary',
  'colorBorder',
  'colorBorderSecondary',
  'colorFill',
  'colorFillSecondary',
  'colorFillTertiary',
  'colorError',
  'colorSuccess',
  'colorWarning',
] as const

describe('theme tokens', () => {
  describe('getPalette', () => {
    it('returns dark palette for dark theme', () => {
      const p = getPalette('dark')
      expect(p.accent).toBe('#1f7ae0')
      expect(p.background).toBe('#141416')
      expect(p.panel).toBe('#1e1e20')
    })

    it('returns light palette for light theme', () => {
      const p = getPalette('light')
      expect(p.accent).toBe('#007aff')
      expect(p.background).toBe('#ffffff')
      expect(p.panel).toBe('#f7f7f7')
    })

    it('dark and light palettes differ for all colors', () => {
      const dark = getPalette('dark')
      const light = getPalette('light')
      for (const key of Object.keys(dark) as (keyof typeof dark)[]) {
        expect(dark[key]).not.toBe(light[key])
      }
    })
  })

  describe('getAntdTokenOverrides', () => {
    it('returns real hex values, not var(--...) strings', () => {
      const dark = getAntdTokenOverrides('dark')
      for (const key of COLOR_TOKEN_KEYS) {
        const value = dark[key] as string
        expect(value).not.toContain('var(')
        expect(value).toMatch(/^(#[0-9a-fA-F]{3,8}|rgba?\()/)
      }
    })

    it('dark overrides use dark palette values', () => {
      const dark = getAntdTokenOverrides('dark')
      const palette = getPalette('dark')
      expect(dark.colorPrimary).toBe(palette.accent)
      expect(dark.colorBgContainer).toBe(palette.panel)
      expect(dark.colorText).toBe(palette.foreground)
      expect(dark.colorError).toBe(palette.error)
    })

    it('light overrides use light palette values', () => {
      const light = getAntdTokenOverrides('light')
      const palette = getPalette('light')
      expect(light.colorPrimary).toBe(palette.accent)
      expect(light.colorBgContainer).toBe(palette.panel)
      expect(light.colorText).toBe(palette.foreground)
      expect(light.colorError).toBe(palette.error)
    })

    it('includes non-color token values', () => {
      const tokens = getAntdTokenOverrides('dark')
      expect(tokens.borderRadius).toBe(10)
      expect(tokens.borderRadiusLG).toBe(14)
      expect(tokens.borderRadiusSM).toBe(6)
      expect(tokens.fontSize).toBe(13)
      expect(tokens.controlHeight).toBe(32)
      expect(tokens.controlHeightSM).toBe(28)
    })

    it('fontFamily uses var(--font-sans) (not a color, no derivation needed)', () => {
      const tokens = getAntdTokenOverrides('dark')
      expect(tokens.fontFamily).toBe('var(--font-sans)')
    })
  })

  describe('injectThemeCssVars', () => {
    beforeEach(() => {
      document.documentElement.style.cssText = ''
    })

    it('sets CSS custom properties for dark theme', () => {
      injectThemeCssVars('dark')
      const style = document.documentElement.style
      expect(style.getPropertyValue('--color-accent')).toBe('#1f7ae0')
      expect(style.getPropertyValue('--color-background')).toBe('#141416')
      expect(style.getPropertyValue('--color-panel')).toBe('#1e1e20')
      expect(style.getPropertyValue('--color-foreground')).toBe('#d4d4d4')
      expect(style.getPropertyValue('--color-border')).toBe('#3a3a3c')
    })

    it('sets CSS custom properties for light theme', () => {
      injectThemeCssVars('light')
      const style = document.documentElement.style
      expect(style.getPropertyValue('--color-accent')).toBe('#007aff')
      expect(style.getPropertyValue('--color-background')).toBe('#ffffff')
      expect(style.getPropertyValue('--color-panel')).toBe('#f7f7f7')
      expect(style.getPropertyValue('--color-foreground')).toBe('#1d1d1f')
      expect(style.getPropertyValue('--color-border')).toBe('#d2d2d7')
    })

    it('overwrites previous theme values when switching', () => {
      injectThemeCssVars('dark')
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#1f7ae0')

      injectThemeCssVars('light')
      expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe('#007aff')
    })

    it('sets all 20 color variables', () => {
      injectThemeCssVars('dark')
      const style = document.documentElement.style
      const expectedVars = [
        '--color-background',
        '--color-foreground',
        '--color-muted',
        '--color-text-tertiary',
        '--color-panel',
        '--color-panel-2',
        '--color-border',
        '--color-border-secondary',
        '--color-accent',
        '--color-accent-hover',
        '--color-warning',
        '--color-error',
        '--color-success',
        '--color-success-hover',
        '--color-hover',
        '--color-active',
        '--color-fill',
        '--color-fill-secondary',
        '--color-fill-tertiary',
        '--color-overlay',
      ]
      for (const v of expectedVars) {
        expect(style.getPropertyValue(v)).not.toBe('')
      }
    })
  })
})
