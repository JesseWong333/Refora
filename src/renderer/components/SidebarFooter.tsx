import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Gear, Moon, Sun, Monitor, Check } from '@phosphor-icons/react'
import { useTheme, type ThemeMode } from '../hooks/useTheme'
import { useClickOutside } from '../hooks/useClickOutside'
import { Button as UiButton } from './ui'

interface SidebarFooterProps {
  onOpenSettings: () => void
}

const THEME_OPTIONS: { mode: ThemeMode; icon: React.ReactNode }[] = [
  { mode: 'system', icon: <Monitor className="h-4 w-4" /> },
  { mode: 'light', icon: <Sun className="h-4 w-4" /> },
  { mode: 'dark', icon: <Moon className="h-4 w-4" /> },
]

const THEME_LABEL_KEYS: Record<ThemeMode, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
}

export default function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
  const { t } = useTranslation()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [themePopoverOpen, setThemePopoverOpen] = useState(false)
  const themePopoverRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(themePopoverRef, () => setThemePopoverOpen(false), themePopoverOpen)

  const currentThemeOption = THEME_OPTIONS.find((o) => o.mode === themeMode) ?? THEME_OPTIONS[0]
  const themeTitle = t(THEME_LABEL_KEYS[themeMode])

  return (
    <div className="mt-auto px-2 py-2">
      <div className="mr-2 flex items-center justify-end gap-2">
        <div className="relative" ref={themePopoverRef}>
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setThemePopoverOpen((v) => !v)}
            title={themeTitle}
            aria-haspopup="menu"
            aria-expanded={themePopoverOpen}
          >
            {currentThemeOption.icon}
          </UiButton>
          {themePopoverOpen && (
            <div
              className="absolute bottom-full right-0 z-50 mb-1 rounded-lg border border-border bg-panel p-1 shadow-lg"
              role="menu"
            >
              {THEME_OPTIONS.map((opt) => {
                const isActive = themeMode === opt.mode
                return (
                  <button
                    key={opt.mode}
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors duration-150 ${
                      isActive ? 'text-accent' : 'text-foreground hover:bg-hover'
                    }`}
                    onClick={() => {
                      setThemeMode(opt.mode)
                      setThemePopoverOpen(false)
                    }}
                  >
                    <span className="flex-shrink-0">{opt.icon}</span>
                    <span className="flex-1 truncate text-left">{t(THEME_LABEL_KEYS[opt.mode])}</span>
                    {isActive && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <UiButton
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onOpenSettings}
          title={t('topbar.settings')}
        >
          <Gear className="h-4 w-4" />
        </UiButton>
      </div>
    </div>
  )
}
