import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { api } from '../ipc'
import { changeLanguage, type AppLanguage } from '../i18n'
import WatchFoldersSettings from './WatchFoldersSettings'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation()
  const [libraryFolderPath, setLibraryFolderPath] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [crossrefMailto, setCrossrefMailto] = useState('')
  const [moveToLibrary, setMoveToLibrary] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWatchFolders, setShowWatchFolders] = useState(false)

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

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
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

  const handleLanguageChange = async (lang: AppLanguage) => {
    setError(null)
    try {
      await api.settings.set('language', lang)
      await changeLanguage(lang)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  if (!open) return null

  const currentLang = (i18n.language?.startsWith('zh') ? 'zh' : 'en') as AppLanguage

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdrop}
    >
      <div
        className="w-[420px] rounded border border-border bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-sm font-semibold text-foreground">
          {t('settings.title')}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">{t('settings.libraryFolder')}</label>
            <div className="flex gap-2">
              <span className="min-w-0 flex-1 truncate rounded bg-panel-2 px-2 py-1.5 text-xs text-foreground">
                {libraryFolderPath || '—'}
              </span>
              <button
                className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
                onClick={handleChooseFolder}
              >
                {t('settings.chooseFolder')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">{t('settings.watchFolders')}</label>
            <button
              className="self-start rounded bg-panel-2 px-3 py-1.5 text-xs text-foreground hover:bg-hover"
              onClick={() => setShowWatchFolders(true)}
            >
              {t('settings.watchFolders')}...
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">{t('settings.proxy')}</label>
            <input
              className="rounded bg-panel-2 px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              onBlur={saveProxy}
              placeholder="http://proxy:8080"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">{t('settings.crossrefMailto')}</label>
            <input
              className="rounded bg-panel-2 px-2 py-1.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-accent"
              value={crossrefMailto}
              onChange={(e) => setCrossrefMailto(e.target.value)}
              onBlur={saveMailto}
              placeholder="user@example.com"
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-muted">{t('settings.theme')}</label>
            <span className="text-xs text-foreground">{t('settings.themeDark')}</span>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-xs text-muted">{t('settings.language')}</label>
            <select
              className="rounded bg-panel-2 px-2 py-1 text-xs text-foreground outline-none"
              value={currentLang}
              onChange={(e) => handleLanguageChange(e.target.value as AppLanguage)}
            >
              <option value="zh">{t('settings.zh')}</option>
              <option value="en">{t('settings.en')}</option>
            </select>
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
          <div className="mt-3 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="rounded bg-accent px-4 py-1.5 text-xs text-white hover:opacity-90"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
        </div>

        <WatchFoldersSettings
          open={showWatchFolders}
          onClose={() => setShowWatchFolders(false)}
        />
      </div>
    </div>
  )
}
