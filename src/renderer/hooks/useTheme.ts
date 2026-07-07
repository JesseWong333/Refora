import { useState, useEffect, useCallback } from 'react'
import { api } from '../ipc'

export type ThemeMode = 'system' | 'dark' | 'light'

const STORAGE_KEY = 'theme'

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === 'system' ? getSystemTheme() : mode
  document.documentElement.setAttribute('data-theme', resolved)
}

export function useTheme() {
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

  return { mode, resolvedTheme, setMode }
}
