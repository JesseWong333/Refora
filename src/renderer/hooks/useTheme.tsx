import { useState, useEffect, useCallback, createContext, useContext, useMemo } from 'react'
import { api } from '../ipc'
import { injectThemeCssVars } from '../theme/tokens'

export type ThemeMode = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

interface ThemeContextValue {
  mode: ThemeMode
  resolvedTheme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

const STORAGE_KEY = 'theme'

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === 'system' ? getSystemTheme() : mode
  document.documentElement.setAttribute('data-theme', resolved)
  injectThemeCssVars(resolved)
}

injectThemeCssVars(getSystemTheme())

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system')

  useEffect(() => {
    api.settings
      .get<string>(STORAGE_KEY, 'system')
      .then((saved: string) => {
        const m = saved === 'dark' || saved === 'light' ? saved : 'system'
        setModeState(m)
        applyTheme(m)
      })
      .catch(() => {
        applyTheme('system')
      })
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (mode === 'system') {
        applyTheme('system')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode)
    applyTheme(newMode)
    api.settings.set(STORAGE_KEY, newMode).catch(() => {})
  }, [])

  const resolvedTheme = mode === 'system' ? getSystemTheme() : mode

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setMode }),
    [mode, resolvedTheme, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within <AppThemeProvider>')
  }
  return ctx
}