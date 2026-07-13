export type ResolvedTheme = 'dark' | 'light'

interface ColorPalette {
  background: string
  foreground: string
  muted: string
  textTertiary: string
  panel: string
  panel2: string
  border: string
  borderSecondary: string
  accent: string
  accentHover: string
  warning: string
  error: string
  success: string
  successHover: string
  hover: string
  active: string
  fill: string
  fillSecondary: string
  fillTertiary: string
  overlay: string
  assistantBubble: string
  inputArea: string
  userBubble: string
}

const darkPalette: ColorPalette = {
  background: '#141416',
  foreground: '#d4d4d4',
  muted: '#a8a8a8',
  textTertiary: '#6e6e73',
  panel: '#1e1e20',
  panel2: '#28282a',
  border: '#3a3a3c',
  borderSecondary: '#2d2d2d',
  accent: '#1f7ae0',
  accentHover: '#3a8de8',
  warning: '#cca700',
  error: '#ff6b5b',
  success: '#4ade80',
  successHover: '#22c55e',
  hover: '#2a2d2e',
  active: '#37373d',
  fill: 'rgba(255, 255, 255, 0.08)',
  fillSecondary: 'rgba(255, 255, 255, 0.05)',
  fillTertiary: 'rgba(255, 255, 255, 0.03)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  assistantBubble: '#2a2a2c',
  inputArea: '#282829',
  userBubble: '#3a3a3c',
}

const lightPalette: ColorPalette = {
  background: '#ffffff',
  foreground: '#1d1d1f',
  muted: '#5f5f64',
  textTertiary: '#8e8e93',
  panel: '#f7f7f7',
  panel2: '#f0f0f0',
  border: '#d2d2d7',
  borderSecondary: '#e5e5ea',
  accent: '#007aff',
  accentHover: '#0062cc',
  warning: '#ff9f0a',
  error: '#ff3b30',
  success: '#34c759',
  successHover: '#28a745',
  hover: 'rgba(0, 0, 0, 0.05)',
  active: 'rgba(0, 0, 0, 0.08)',
  fill: 'rgba(0, 0, 0, 0.08)',
  fillSecondary: 'rgba(0, 0, 0, 0.05)',
  fillTertiary: 'rgba(0, 0, 0, 0.03)',
  overlay: 'rgba(0, 0, 0, 0.3)',
  assistantBubble: '#f8f8f8',
  inputArea: '#fbfbfb',
  userBubble: '#f3f3f3',
}

export function getPalette(theme: ResolvedTheme): ColorPalette {
  return theme === 'dark' ? darkPalette : lightPalette
}

const cssVarMap: Readonly<Record<keyof ColorPalette, string>> = {
  background: '--color-background',
  foreground: '--color-foreground',
  muted: '--color-muted',
  textTertiary: '--color-text-tertiary',
  panel: '--color-panel',
  panel2: '--color-panel-2',
  border: '--color-border',
  borderSecondary: '--color-border-secondary',
  accent: '--color-accent',
  accentHover: '--color-accent-hover',
  warning: '--color-warning',
  error: '--color-error',
  success: '--color-success',
  successHover: '--color-success-hover',
  hover: '--color-hover',
  active: '--color-active',
  fill: '--color-fill',
  fillSecondary: '--color-fill-secondary',
  fillTertiary: '--color-fill-tertiary',
  overlay: '--color-overlay',
  assistantBubble: '--color-assistant-bubble',
  inputArea: '--color-input-area',
  userBubble: '--color-user-bubble',
}

export function injectThemeCssVars(theme: ResolvedTheme): void {
  const palette = getPalette(theme)
  const root = document.documentElement
  for (const key of Object.keys(cssVarMap) as (keyof ColorPalette)[]) {
    root.style.setProperty(cssVarMap[key], palette[key])
  }
}

export function getAntdTokenOverrides(theme: ResolvedTheme) {
  const p = getPalette(theme)
  return {
    colorPrimary: p.accent,
    colorPrimaryHover: p.accentHover,
    colorBgLayout: p.background,
    colorBgContainer: p.panel,
    colorBgElevated: p.panel2,
    colorBgSpotlight: p.panel2,
    colorText: p.foreground,
    colorTextSecondary: p.muted,
    colorTextTertiary: p.textTertiary,
    colorBorder: p.border,
    colorBorderSecondary: p.borderSecondary,
    colorFill: p.fill,
    colorFillSecondary: p.fillSecondary,
    colorFillTertiary: p.fillTertiary,
    colorError: p.error,
    colorSuccess: p.success,
    colorWarning: p.warning,
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 6,
    fontSize: 13,
    fontFamily: 'var(--font-sans)',
    controlHeight: 32,
    controlHeightSM: 28,
  }
}
