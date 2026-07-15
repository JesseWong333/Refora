import { useTranslation } from 'react-i18next'
import { useState, useEffect, type ReactNode } from 'react'
import { Modal, Button, Select } from '@lobehub/ui'
import { FolderOpen, Palette, Sparkle } from '@phosphor-icons/react'
import { useTheme } from '../hooks/useTheme'
import { api } from '../ipc'
import { changeLanguage, type AppLanguage } from '../i18n'
import { errorMessage } from '../../shared/ipc-types'
import { Input as UiInput } from './ui'
import { AiProvidersSection as ProviderConnectionsSection } from './AiProvidersSection'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const LANG_OPTIONS = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

type SettingsPage = 'general' | 'appearance' | 'aiProviders'

function SettingsSection({
  title,
  description,
  action,
  children
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h4 className="text-sm font-semibold text-foreground">
            {title}
          </h4>
          {description && <p className="text-label text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [libraryFolderPath, setLibraryFolderPath] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [crossrefMailto, setCrossrefMailto] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [activePage, setActivePage] = useState<SettingsPage>('general')

  useEffect(() => {
    if (open) {
      setError(null)
      setActivePage('general')
      void loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    try {
      const lib = await api.settings.get<string>('libraryFolderPath', '')
      const proxy = await api.settings.get<string>('proxyUrl', '')
      const mailto = await api.settings.get<string>('crossrefMailto', '')
      const sc = await api.settings.get<string>('sidebarCollapsed', '0')
      setLibraryFolderPath(lib)
      setProxyUrl(proxy)
      setCrossrefMailto(mailto)
      setSidebarCollapsed(sc === '1')
    } catch {
      setError('Failed to load settings')
    }
  }

  const handleChooseFolder = async () => {
    setError(null)
    try {
      const path = await api.dialog.openDirectory()
      if (!path) return
      setSwitching(true)
      await api.library.switch(path)
      setLibraryFolderPath(path)
    } catch (e) {
      setError(errorMessage(e, 'Failed to set library folder'))
    } finally {
      setSwitching(false)
    }
  }

  const saveProxy = async () => {
    setError(null)
    try {
      await api.settings.set('proxyUrl', proxyUrl)
    } catch (e) {
      setError(errorMessage(e, 'Failed to save proxy'))
    }
  }

  const saveMailto = async () => {
    setError(null)
    try {
      await api.settings.set('crossrefMailto', crossrefMailto)
    } catch (e) {
      setError(errorMessage(e, 'Failed to save mailto'))
    }
  }

  const handleSidebarToggle = async () => {
    const newVal = !sidebarCollapsed
    setSidebarCollapsed(newVal)
    try {
      await api.settings.set('sidebarCollapsed', newVal ? '1' : '0')
    } catch (e) {
      setSidebarCollapsed(!newVal)
      setError(errorMessage(e, 'Failed to update sidebar'))
    }
  }

  const handleThemeChange = (value: string) => {
    setThemeMode(value as 'system' | 'dark' | 'light')
  }

  const handleLanguageChange = async (value: string) => {
    const lang = value as AppLanguage
    setError(null)
    try {
      await api.settings.set('language', lang)
      await changeLanguage(lang)
    } catch (e) {
      setError(errorMessage(e, 'Failed to change language'))
    }
  }

  const currentLang = (i18n.language?.startsWith('zh') ? 'zh' : 'en') as AppLanguage
  const pages = [
    {
      id: 'general' as const,
      label: t('settings.sectionGeneral.title'),
      description: t('settings.sectionGeneral.desc'),
      icon: FolderOpen
    },
    {
      id: 'appearance' as const,
      label: t('settings.sectionAppearance.title'),
      description: t('settings.sectionAppearance.desc'),
      icon: Palette
    },
    {
      id: 'aiProviders' as const,
      label: t('settings.aiProviders.title'),
      description: t('settings.aiProviders.desc'),
      icon: Sparkle
    }
  ]

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={null}
      width={920}
      className="settings-modal-shell"
      paddings={{ desktop: 0 }}
      styles={{ body: { padding: 0 } }}
      footer={null}
      destroyOnHidden
    >
      <div
        className="flex h-[min(68vh,680px)] min-h-[520px] overflow-hidden"
        data-settings-layout
      >
        <aside className="settings-titlebar-material flex w-52 shrink-0 flex-col border-r border-border p-3 pt-12">
          <nav className="flex flex-col gap-1" aria-label={t('settings.title')}>
            {pages.map((page) => {
              const Icon = page.icon
              const selected = page.id === activePage
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                    selected
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted hover:bg-background/60 hover:text-foreground'
                  }`}
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => {
                    setActivePage(page.id)
                    setError(null)
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" weight={selected ? 'fill' : 'regular'} />
                  <span className="truncate">{page.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-background p-5 pt-12">
          {activePage === 'general' && (
            <SettingsSection
              title={t('settings.sectionGeneral.title')}
              description={t('settings.sectionGeneral.desc')}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">{t('settings.libraryFolder')}</label>
                <div className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2 px-3 py-1.5 text-xs text-foreground">
                    {libraryFolderPath || '\u2014'}
                  </span>
                  <Button size="small" onClick={handleChooseFolder} loading={switching}>
                    {switching ? t('settings.switching') : t('settings.chooseFolder')}
                  </Button>
                </div>
                <span className="text-label text-muted">
                  {t('settings.libraryFolderAutoImportHint')}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">{t('settings.proxy')}</label>
                <UiInput
                  variant="outlined"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  onBlur={saveProxy}
                  onPressEnter={saveProxy}
                  placeholder="http://proxy:8080"
                  inputSize="sm"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted">{t('settings.crossrefMailto')}</label>
                <UiInput
                  variant="outlined"
                  value={crossrefMailto}
                  onChange={(e) => setCrossrefMailto(e.target.value)}
                  onBlur={saveMailto}
                  onPressEnter={saveMailto}
                  placeholder="user@example.com"
                  inputSize="sm"
                />
              </div>
            </SettingsSection>
          )}

          {activePage === 'appearance' && (
            <SettingsSection
              title={t('settings.sectionAppearance.title')}
              description={t('settings.sectionAppearance.desc')}
            >
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted">{t('settings.theme')}</label>
                <Select
                  value={themeMode}
                  onChange={handleThemeChange}
                  options={THEME_OPTIONS}
                  size="small"
                  style={{ width: 140 }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs text-muted">{t('settings.language')}</label>
                <Select
                  value={currentLang}
                  onChange={handleLanguageChange}
                  options={LANG_OPTIONS}
                  size="small"
                  style={{ width: 140 }}
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="m-0"
                  checked={sidebarCollapsed}
                  onChange={handleSidebarToggle}
                />
                <span className="text-xs text-foreground">
                  {t('settings.sidebarCollapsed')}
                </span>
              </label>
            </SettingsSection>
          )}

          {activePage === 'aiProviders' && <ProviderConnectionsSection />}

          {error && (
            <div className="mt-4 rounded-lg bg-error/10 px-3 py-1.5 text-xs text-error">
              {error}
            </div>
          )}
        </main>
      </div>
    </Modal>
  )
}
