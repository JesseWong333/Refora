import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { Modal, Button, Input, Select } from '@lobehub/ui'
import { useTheme } from '../hooks/useTheme'
import { api } from '../ipc'
import { changeLanguage, type AppLanguage } from '../i18n'

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

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [libraryFolderPath, setLibraryFolderPath] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [crossrefMailto, setCrossrefMailto] = useState('')
  const [moveToLibrary, setMoveToLibrary] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setError(null)
      void loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    try {
      const lib = await api.settings.get<string>('libraryFolderPath', '')
      const proxy = await api.settings.get<string>('proxyUrl', '')
      const mailto = await api.settings.get<string>('crossrefMailto', '')
      const mtl = await api.settings.get<string>('moveToLibraryOnCategorize', '1')
      const sc = await api.settings.get<string>('sidebarCollapsed', '0')
      setLibraryFolderPath(lib)
      setProxyUrl(proxy)
      setCrossrefMailto(mailto)
      setMoveToLibrary(mtl === '1')
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
      await api.settings.set('libraryFolderPath', path)
      setLibraryFolderPath(path)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || 'Failed to set library folder')
    }
  }

  const saveProxy = async () => {
    setError(null)
    try {
      await api.settings.set('proxyUrl', proxyUrl)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const saveMailto = async () => {
    setError(null)
    try {
      await api.settings.set('crossrefMailto', crossrefMailto)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const handleMoveToLibraryToggle = async () => {
    const newVal = !moveToLibrary
    setMoveToLibrary(newVal)
    try {
      await api.settings.set('moveToLibraryOnCategorize', newVal ? '1' : '0')
    } catch (e) {
      setMoveToLibrary(!newVal)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const handleSidebarToggle = async () => {
    const newVal = !sidebarCollapsed
    setSidebarCollapsed(newVal)
    try {
      await api.settings.set('sidebarCollapsed', newVal ? '1' : '0')
    } catch (e) {
      setSidebarCollapsed(!newVal)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
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
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const currentLang = (i18n.language?.startsWith('zh') ? 'zh' : 'en') as AppLanguage

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('settings.title')}
      footer={
        <Button onClick={onClose} type="primary">
          {t('common.cancel')}
        </Button>
      }
      destroyOnClose
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.libraryFolder')}</label>
          <div className="flex gap-2">
            <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2 px-3 py-1.5 text-xs text-foreground">
              {libraryFolderPath || '\u2014'}
            </span>
            <Button size="small" onClick={handleChooseFolder}>
              {t('settings.chooseFolder')}
            </Button>
          </div>
          <span className="text-[11px] text-muted">{t('settings.libraryFolderAutoImportHint')}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.proxy')}</label>
          <Input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            onBlur={saveProxy}
            placeholder="http://proxy:8080"
            size="small"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.crossrefMailto')}</label>
          <Input
            value={crossrefMailto}
            onChange={(e) => setCrossrefMailto(e.target.value)}
            onBlur={saveMailto}
            placeholder="user@example.com"
            size="small"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">{t('settings.theme')}</label>
          <Select
            value={themeMode}
            onChange={handleThemeChange}
            options={THEME_OPTIONS}
            size="small"
            style={{ width: 120 }}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">{t('settings.language')}</label>
          <Select
            value={currentLang}
            onChange={handleLanguageChange}
            options={LANG_OPTIONS}
            size="small"
            style={{ width: 120 }}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="m-0"
            checked={moveToLibrary}
            onChange={handleMoveToLibraryToggle}
          />
          <span className="text-xs text-foreground">
            {t('settings.moveToLibraryOnCategorize')}
          </span>
        </label>

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
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">
          {error}
        </div>
      )}
    </Modal>
  )
}
