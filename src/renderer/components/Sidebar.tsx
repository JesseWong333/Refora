import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FilePlus, FolderPlus, ArrowLineLeft, ArrowLineRight, CircleNotch } from '@phosphor-icons/react'
import { useDocumentStore } from '../store/documentStore'
import { errorMessage } from '../../shared/ipc-types'
import SettingsModal from './SettingsModal'
import { Button as UiButton } from './ui'
import { api } from '../ipc'
import SidebarSmartItems from './SidebarSmartItems'
import SidebarWorkspaces from './SidebarWorkspaces'
import SidebarCategories from './SidebarCategories'
import SidebarFooter from './SidebarFooter'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
}



export default function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation()
  const fetchDocuments = useDocumentStore((s) => s.fetchDocuments)
  const importProgress = useDocumentStore((s) => s.importProgress)
  const pendingMetadataCount = useDocumentStore((s) => s.pendingMetadataCount)
  const [showSettings, setShowSettings] = useState(false)
  const isMac = document.documentElement.dataset.platform === 'mac'

  const handleAddFiles = useCallback(async () => {
    try {
      await api.import.addFiles([])
    } catch (e) { useDocumentStore.getState().showToast(errorMessage(e, 'Failed to import files')) }
    void fetchDocuments()
  }, [fetchDocuments])

  const handleAddFolder = useCallback(async () => {
    try {
      await api.import.addFolder('')
    } catch (e) { useDocumentStore.getState().showToast(errorMessage(e, 'Failed to import folder')) }
    void fetchDocuments()
  }, [fetchDocuments])

  if (collapsed) {
    const toolbarLeft = isMac ? 92 : 8
    const toolbar = (
      <div
        className="sidebar-floating-toolbar drag-region"
        style={{ left: `${toolbarLeft}px` }}
      >
        <UiButton
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onToggleCollapse}
          title={t('settings.sidebarCollapsed')}
          aria-label={t('settings.sidebarCollapsed')}
        >
          <ArrowLineRight className="h-4 w-4" />
        </UiButton>
        <div className="toolbar-sep" aria-hidden="true" />
        <UiButton
          variant="ghost"
          size="sm"
          iconOnly
          onClick={handleAddFiles}
          title={`${t('topbar.addFile')} (⌘I)`}
          aria-label={t('topbar.addFile')}
        >
          <FilePlus className="h-4 w-4" />
        </UiButton>
        <UiButton
          variant="ghost"
          size="sm"
          iconOnly
          onClick={handleAddFolder}
          title={t('topbar.addFolder')}
          aria-label={t('topbar.addFolder')}
        >
          <FolderPlus className="h-4 w-4" />
        </UiButton>
      </div>
    )
    return (
      <>
        {createPortal(toolbar, document.body)}
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      </>
    )
  }

  return (
    <aside className="sidebar-floating flex h-full w-full shrink-0 flex-col">
      <div className={`drag-region flex h-10 shrink-0 items-center px-2 ${isMac ? 'pl-[68px]' : ''}`}>
        <div className="ml-auto mr-2 flex items-center gap-3 no-drag">
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleCollapse}
            title={t('settings.sidebarCollapsed')}
            aria-label={t('settings.sidebarCollapsed')}
          >
            <ArrowLineLeft className="h-4 w-4" />
          </UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleAddFiles}
            title={`${t('topbar.addFile')} (⌘I)`}
            aria-label={t('topbar.addFile')}
          >
            <FilePlus className="h-4 w-4" />
          </UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleAddFolder}
            title={t('topbar.addFolder')}
            aria-label={t('topbar.addFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </UiButton>
        </div>
      </div>

      {importProgress && (
        <div className="mx-2 mb-1 flex items-center gap-2 text-label text-muted">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
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

      {!importProgress && pendingMetadataCount > 0 && (
        <div className="mx-2 mb-1 flex items-center gap-2 text-label text-muted">
          <CircleNotch className="h-3 w-3 animate-spin text-accent" />
          <span className="whitespace-nowrap">
            {t('topbar.refreshingMetadata', { count: pendingMetadataCount })}
          </span>
        </div>
      )}

      <nav className="min-h-0 flex-1 overflow-y-auto py-2">
        <SidebarSmartItems />
        <SidebarWorkspaces />
        <SidebarCategories />
      </nav>

      <SidebarFooter onOpenSettings={() => setShowSettings(true)} />


      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </aside>
  )
}
