import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, FileJson, FileText, Moon, Sun, Monitor, Check } from 'lucide-react'
import { useDocumentStore } from '../store/documentStore'
import { useTheme, type ThemeMode } from '../hooks/useTheme'
import { useClickOutside } from '../hooks/useClickOutside'
import { api } from '../ipc'
import { SidebarItem } from './sidebarShared'

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
  const selectedIds = useDocumentStore((s) => s.selectedIds)
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [themePopoverOpen, setThemePopoverOpen] = useState(false)
  const themePopoverRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(themePopoverRef, () => setThemePopoverOpen(false), themePopoverOpen)

  const currentThemeOption = THEME_OPTIONS.find((o) => o.mode === themeMode) ?? THEME_OPTIONS[0]
  const themeTitle = t(THEME_LABEL_KEYS[themeMode])

  return (
    <div className="mt-auto border-t border-border px-1 py-2">
      <SidebarItem
        icon={<Settings className="h-4 w-4" />}
        label={t('topbar.settings')}
        onClick={onOpenSettings}
      />
      <SidebarItem
        icon={<FileJson className="h-4 w-4" />}
        label={t('topbar.exportJson')}
        title={`${t('topbar.exportJson')} (⌘E)`}
        onClick={() => { void api.export.toJson() }}
      />
      <SidebarItem
        icon={<FileText className="h-4 w-4" />}
        label={t('topbar.exportBibtex')}
        title={`${t('topbar.exportBibtex')} (⌘⇧B)`}
        onClick={() => { void api.export.toBibtex(selectedIds) }}
        muted={selectedIds.length === 0}
        active={false}
      />
      <div className="relative mt-1 px-1" ref={themePopoverRef}>
        <button
          className="sidebar-item flex w-full items-center gap-2 px-2.5 text-xs text-foreground"
          onClick={() => setThemePopoverOpen((v) => !v)}
          title={themeTitle}
          aria-haspopup="menu"
          aria-expanded={themePopoverOpen}
        >
          {currentThemeOption?.icon && (
            <span className="flex-shrink-0 opacity-70">{currentThemeOption.icon}</span>
          )}
          <span className="truncate">{themeTitle}</span>
        </button>
        {themePopoverOpen && (
          <div
            className="absolute bottom-full left-1 right-1 z-50 mb-1 rounded-lg border border-border bg-panel p-1 shadow-lg"
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
                  <span className="flex-shrink-0 opacity-70">{opt.icon}</span>
                  <span className="flex-1 truncate text-left">{t(THEME_LABEL_KEYS[opt.mode])}</span>
                  {isActive && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
