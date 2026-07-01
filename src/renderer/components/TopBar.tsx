import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { api } from '../ipc'
import { useDocumentStore } from '../store/documentStore'
import WatchFoldersSettings from './WatchFoldersSettings'
import SettingsModal from './SettingsModal'

interface TopBarProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

export default function TopBar({ sidebarCollapsed, onToggleSidebar }: TopBarProps) {
  const { t } = useTranslation()
  const isImporting = useDocumentStore((s) => s.isImporting)
  const importProgress = useDocumentStore((s) => s.importProgress)
  const [showWatchFolders, setShowWatchFolders] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const searchQuery = useDocumentStore((s) => s.searchQuery)
  const performSearch = useDocumentStore((s) => s.performSearch)
  const clearSearch = useDocumentStore((s) => s.clearSearch)
  const selectedIds = useDocumentStore((s) => s.selectedIds)

  const handleAddFile = () => {
    void api.import.addFiles([])
  }

  const handleAddFolder = () => {
    void api.import.addFolder('')
  }

  const handleExportBibtex = () => {
    if (selectedIds.length === 0) return
    void api.export.toBibtex(selectedIds)
  }

  const handleExportJson = () => {
    void api.export.toJson()
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      <button
        className="toolbar-btn"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        {sidebarCollapsed ? '\u00BB' : '\u00AB'}
      </button>
      <span className="mx-2 text-sm font-semibold">ScholarNote</span>
      <div className="mx-1 h-5 w-px bg-border" />
      <button className="toolbar-btn" onClick={handleAddFile} disabled={isImporting}>
        {t('topbar.addFile')}
      </button>
      <button className="toolbar-btn" onClick={handleAddFolder} disabled={isImporting}>
        {t('topbar.addFolder')}
      </button>
      <button className="toolbar-btn" onClick={() => setShowWatchFolders(true)}>{t('topbar.watchFolder')}</button>
      <button className="toolbar-btn" onClick={() => setShowSettings(true)}>{t('topbar.settings')}</button>
      <button className="toolbar-btn" onClick={handleExportJson}>{t('topbar.exportJson')}</button>
      <button className="toolbar-btn" onClick={handleExportBibtex} disabled={selectedIds.length === 0}>{t('topbar.exportBibtex')}</button>
      <div className="ml-auto flex items-center gap-2">
        {importProgress && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-2 w-32 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent transition-all duration-200"
                style={{
                  width: `${importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}%`
                }}
              />
            </div>
            <span className="whitespace-nowrap">
              {t('topbar.importing', { current: importProgress.current, total: importProgress.total })}
            </span>
          </div>
        )}
        <input
          className="search-input"
          placeholder={t('topbar.search')}
          value={searchQuery}
          onChange={(e) => performSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              clearSearch()
            }
          }}
        />
      </div>
      <WatchFoldersSettings
        open={showWatchFolders}
        onClose={() => setShowWatchFolders(false)}
      />
      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  )
}
