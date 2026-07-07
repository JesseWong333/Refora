import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider, Modal, Button, Input } from '@lobehub/ui'
import { theme as antdTheme } from 'antd'
import { useTheme, AppThemeProvider } from '@renderer/hooks/useTheme'

afterEach(cleanup)

let storedTheme = 'system'
;(window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes('dark'),
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('@renderer/ipc', () => ({
  api: {
    settings: {
      get: async (_k: string, def: string) => storedTheme ?? def,
      set: async (_k: string, v: string) => {
        storedTheme = v
      },
    },
  },
}))

function injectedCss() {
  return Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent || '')
    .join('\n')
}

// Mirrors the fixed App structure: AppThemeProvider wraps AppInner which owns
// the lobehub ThemeProvider driven by useTheme, while a child (SettingsModal)
// uses the SAME shared useTheme (now backed by context) to change the theme.
function AppShell() {
  return (
    <AppThemeProvider>
      <AppInner />
    </AppThemeProvider>
  )
}

function AppInner() {
  const { mode, resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  return (
    <ThemeProvider
      appearance={resolvedTheme}
      themeMode={mode === 'system' ? 'auto' : mode}
      theme={{
        token: {
          colorBgContainer: isDark ? '#252526' : '#ffffff',
          colorText: isDark ? '#d4d4d4' : '#1d1d1f',
          colorBorder: isDark ? '#3c3c3c' : '#d2d2d7',
        },
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      }}
      enableGlobalStyle={false}
      enableCustomFonts={false}
    >
      <ChildChanger />
      <Modal open title="test" footer={<Button>ok</Button>}>
        <Input placeholder="x" />
      </Modal>
    </ThemeProvider>
  )
}

function ChildChanger() {
  const { setMode } = useTheme()
  return (
    <button data-testid="to-light" onClick={() => setMode('light')}>
      to-light
    </button>
  )
}

function cssVarValue(css: string, name: string): string | null {
  const m = css.match(new RegExp(`${name}:([^;]+);`))
  return m ? m[1] : null
}

describe('Modal theme shared via context', () => {
  it('changing theme from a child updates Modal (fixed)', async () => {
    storedTheme = 'system'
    render(<AppShell />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    // system => dark
    expect(cssVarValue(injectedCss(), '--ant-color-bg-container')).toBe('#252526')

    // Child switches to light — now propagates via shared context to AppInner
    await act(async () => {
      fireEvent.click(screen.getByTestId('to-light'))
    })

    expect(cssVarValue(injectedCss(), '--ant-color-bg-container')).toBe('#ffffff')
    expect(cssVarValue(injectedCss(), '--ant-color-text')).toBe('#1d1d1f')
  })
})