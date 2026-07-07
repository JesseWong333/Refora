import type { ReactNode } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Files,
  Clock,
  Plus,
  Star,
  Pencil,
  Trash2,
  Settings,
  FileJson,
  FileText,
  FilePlus,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  Monitor,
  Loader2
} from 'lucide-react'
import { Button, showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { useDocumentStore } from '../store/documentStore'
import { useTheme } from '../hooks/useTheme'
import type { ListMode, Category } from '../../shared/ipc-types'
import CategoryDialog from './CategoryDialog'
import type { CategoryDialogState } from './CategoryDialog'
import SettingsModal from './SettingsModal'
import { api } from '../ipc'

const DOC_MIME = 'application/x-refora-docids'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
}

const SMART_ITEMS: { key: string; mode: ListMode; icon: ReactNode }[] = [
  { key: 'allFiles', mode: 'all', icon: <Files className="h-4 w-4" /> },
  { key: 'recentlyRead', mode: 'recentlyRead', icon: <Clock className="h-4 w-4" /> },
  { key: 'recentlyAdded', mode: 'recentlyAdded', icon: <Plus className="h-4 w-4" /> },
  { key: 'starred', mode: 'starred', icon: <Star className="h-4 w-4" /> }
]

function SidebarItem({
  icon,
  label,
  muted = false,
  active = false,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop
}: {
  icon?: ReactNode
  label: string
  muted?: boolean
  active?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  return (
    <div
      className={`sidebar-item ${
        active ? 'sidebar-item-active' : muted ? 'text-muted' : 'text-foreground'
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onClick) onClick()
      }}
    >
      {icon && <span className="flex-shrink-0 opacity-70">{icon}</span>}
      <span className="truncate">{label}</span>
    </div>
  )
}

function SidebarSection({
  title,
  onContextMenu,
  action,
  children
}: {
  title: string
  onContextMenu?: (e: React.MouseEvent) => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted cursor-context-menu"
        onContextMenu={onContextMenu}
      >
        <span className="flex-1">{title}</span>
        {action}
      </div>
      <div className="px-1">{children}</div>
    </div>
  )
}

export default function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation()
  const listMode = useDocumentStore((s) => s.listMode)
  const setListMode = useDocumentStore((s) => s.setListMode)
  const categories = useDocumentStore((s) => s.categories)
  const fetchCategories = useDocumentStore((s) => s.fetchCategories)
  const fetchDocuments = useDocumentStore((s) => s.fetchDocuments)
  const createCategory = useDocumentStore((s) => s.createCategory)
  const renameCategory = useDocumentStore((s) => s.renameCategory)
  const deleteCategory = useDocumentStore((s) => s.deleteCategory)

  const handleAddFiles = useCallback(async () => {
    try {
      await api.import.addFiles([])
    } catch { void 0 }
    void fetchDocuments()
  }, [fetchDocuments])

  const handleAddFolder = useCallback(async () => {
    try {
      await api.import.addFolder('')
    } catch { void 0 }
    void fetchDocuments()
  }, [fetchDocuments])
  const focusedDocId = useDocumentStore((s) => s.focusedDocId)
  const importProgress = useDocumentStore((s) => s.importProgress)
  const pendingMetadataCount = useDocumentStore((s) => s.pendingMetadataCount)

  const [dialog, setDialog] = useState<CategoryDialogState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingCatImports, setPendingCatImports] = useState<Set<string>>(new Set())
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const selectedIds = useDocumentStore((s) => s.selectedIds)

  const isMac = document.documentElement.dataset.platform === 'mac'

  useEffect(() => {
    void fetchCategories()
  }, [])

  const handleCategoryClick = useCallback(
    (cat: Category) => {
      setListMode({ mode: 'category', categoryId: cat.id })
    },
    [setListMode]
  )

  const handleCreate = useCallback(() => {
    setDialog({ mode: 'create' })
  }, [])

  const handleRename = useCallback(
    (cat: Category) => {
      setDialog({ mode: 'rename', category: cat })
    },
    []
  )

  const handleDelete = useCallback(
    (cat: Category) => {
      setDeleteConfirm(cat)
    },
    []
  )

  const handleSectionContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const items: ContextMenuItem[] = [
        {
          key: 'create',
          label: t('sidebar.createCategory'),
          icon: <Plus className="h-3.5 w-3.5" />,
          onClick: handleCreate,
        },
      ]
      showContextMenu(items)
    },
    [t, handleCreate]
  )

  const handleItemContext = useCallback(
    (e: React.MouseEvent, cat: Category) => {
      e.preventDefault()
      e.stopPropagation()
      const items: ContextMenuItem[] = [
        {
          key: 'create',
          label: t('sidebar.createCategory'),
          icon: <Plus className="h-3.5 w-3.5" />,
          onClick: handleCreate,
        },
        {
          key: 'rename',
          label: t('sidebar.renameCategory'),
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => handleRename(cat),
        },
        {
          key: 'delete',
          label: t('sidebar.deleteCategory'),
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onClick: () => handleDelete(cat),
          danger: true,
        },
      ]
      showContextMenu(items)
    },
    [t, handleCreate, handleRename, handleDelete]
  )

  const handleDragOverCategory = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(DOC_MIME) ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const handleDropCategory = useCallback(
    async (catId: string, e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DOC_MIME)
      if (raw) {
        e.preventDefault()
        try {
          const ids: string[] = JSON.parse(raw)
          if (ids.length === 1) {
            await api.categories.assign(ids[0], catId)
          } else {
            await api.documents.bulkCategorize(ids, catId)
          }
          void fetchCategories()
        } catch {
          void 0
        }
        return
      }

      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        e.preventDefault()
        const paths: string[] = []
        for (let i = 0; i < files.length; i++) {
          try {
            const p = api.getPathForFile(files[i] as File)
            if (p && p.toLowerCase().endsWith('.pdf')) {
              paths.push(p)
            }
          } catch {
            void 0
          }
        }
        if (paths.length === 0) return

        setPendingCatImports((prev) => new Set(prev).add(catId))
        useDocumentStore.setState((s) => ({
          categories: s.categories.map((c) =>
            c.id === catId ? { ...c, count: (c.count ?? 0) + paths.length } : c
          )
        }))

        try {
          const addedIds = await api.import.addFiles(paths)
          for (const id of addedIds) {
            await api.categories.assign(id, catId)
          }
        } catch {
          void 0
        }
        setPendingCatImports((prev) => {
          const next = new Set(prev)
          next.delete(catId)
          return next
        })
        void fetchCategories()
        void fetchDocuments()
      }
    },
    [fetchCategories, fetchDocuments]
  )

  const confirmDeleteCategory = useCallback(async () => {
    if (!deleteConfirm) return
    await deleteCategory(deleteConfirm.id)
    if (listMode.mode === 'category' && listMode.categoryId === deleteConfirm.id) {
      setListMode({ mode: 'all' })
    }
    if (focusedDocId) {
      useDocumentStore.getState().setFocusedDoc(null)
    }
    setDeleteConfirm(null)
  }, [deleteConfirm, deleteCategory, listMode, focusedDocId, setListMode])

  const handleDialogSave = useCallback(
    async (name: string) => {
      if (dialog?.mode === 'create') {
        await createCategory(name)
      } else if (dialog?.mode === 'rename' && dialog.category) {
        await renameCategory(dialog.category.id, name)
      }
    },
    [dialog, createCategory, renameCategory]
  )

  const cycleTheme = useCallback(() => {
    if (themeMode === 'system') setThemeMode('light')
    else if (themeMode === 'light') setThemeMode('dark')
    else setThemeMode('system')
  }, [themeMode, setThemeMode])

  const ThemeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor
  const themeTitle =
    themeMode === 'dark' ? t('settings.themeDark') : themeMode === 'light' ? t('settings.themeLight') : t('settings.themeSystem')

  if (collapsed) {
    const toolbarLeft = isMac ? 92 : 8
    return (
      <>
        <div
          className="sidebar-floating-toolbar no-drag"
          style={{ left: `${toolbarLeft}px` }}
        >
          <button
            onClick={onToggleCollapse}
            title={t('settings.sidebarCollapsed')}
            aria-label={t('settings.sidebarCollapsed')}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
          <div className="toolbar-sep" aria-hidden="true" />
          <button
            onClick={handleAddFiles}
            title={t('topbar.addFile')}
            aria-label={t('topbar.addFile')}
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            onClick={handleAddFolder}
            title={t('topbar.addFolder')}
            aria-label={t('topbar.addFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      </>
    )
  }

  return (
    <aside className="sidebar-floating flex h-full w-full shrink-0 flex-col">
      {/* Header: drag region with action buttons on the right */}
      <div className={`drag-region flex h-10 shrink-0 items-center px-2 ${isMac ? 'pl-[68px]' : ''}`}>
        <div className="ml-auto flex items-center no-drag">
          <button
            className="sidebar-header-btn"
            onClick={handleAddFiles}
            title={t('topbar.addFile')}
            aria-label={t('topbar.addFile')}
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            className="sidebar-header-btn"
            onClick={handleAddFolder}
            title={t('topbar.addFolder')}
            aria-label={t('topbar.addFolder')}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
          <div className="mx-1 h-3.5 w-px bg-border" aria-hidden="true" />
          <button
            className="sidebar-header-btn"
            onClick={onToggleCollapse}
            title={t('settings.sidebarCollapsed')}
            aria-label={t('settings.sidebarCollapsed')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Import progress */}
      {importProgress && (
        <div className="mx-2 mb-1 flex items-center gap-2 text-[11px] text-muted">
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

      {/* Background metadata refresh indicator */}
      {!importProgress && pendingMetadataCount > 0 && (
        <div className="mx-2 mb-1 flex items-center gap-2 text-[11px] text-muted">
          <Loader2 className="h-3 w-3 animate-spin text-accent" />
          <span className="whitespace-nowrap">
            {t('topbar.refreshingMetadata', { count: pendingMetadataCount })}
          </span>
        </div>
      )}

      {/* Scrollable nav */}
      <nav className="min-h-0 flex-1 overflow-y-auto py-2">
        <div className="mb-4 px-1">
          {SMART_ITEMS.map((item) => (
            <SidebarItem
              key={item.key}
              icon={item.icon}
              label={t(`sidebar.${item.key}`)}
              active={listMode.mode === item.mode}
              onClick={() => setListMode({ mode: item.mode })}
            />
          ))}
        </div>
        <SidebarSection
          title={t('sidebar.categories')}
          onContextMenu={handleSectionContext}
          action={
            <Button
              type="text"
              size="small"
              className="no-drag -mr-1 p-0.5 text-muted hover:text-foreground"
              onClick={handleCreate}
              title={t('sidebar.createCategory')}
              aria-label={t('sidebar.createCategory')}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          }
        >
          {categories.length === 0 ? (
            <div className="px-2 py-1 text-[11px] italic text-muted">
              {t('sidebar.emptyCategories')}
            </div>
          ) : (
            categories.map((c) => {
              const isPending = pendingCatImports.has(c.id)
              return (
                <div key={c.id} className="relative">
                  <SidebarItem
                    icon={isPending ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : undefined}
                    label={`${c.name} (${c.count ?? 0})`}
                    active={listMode.mode === 'category' && listMode.categoryId === c.id}
                    onClick={() => handleCategoryClick(c)}
                    onContextMenu={(e) => handleItemContext(e, c)}
                    onDragOver={handleDragOverCategory}
                    onDrop={(e) => handleDropCategory(c.id, e)}
                  />
                  {isPending && <div className="cat-drop-pulse absolute inset-0" />}
                </div>
              )
            })
          )}
        </SidebarSection>
      </nav>

      {/* Footer: settings, export, theme */}
      <div className="mt-auto border-t border-border px-1 py-2">
        <SidebarItem
          icon={<Settings className="h-4 w-4" />}
          label={t('topbar.settings')}
          onClick={() => setShowSettings(true)}
        />
        <SidebarItem
          icon={<FileJson className="h-4 w-4" />}
          label={t('topbar.exportJson')}
          onClick={() => { void api.export.toJson() }}
        />
        <SidebarItem
          icon={<FileText className="h-4 w-4" />}
          label={t('topbar.exportBibtex')}
          onClick={() => { void api.export.toBibtex(selectedIds) }}
          muted={selectedIds.length === 0}
          active={false}
        />
        <div className="mt-1 px-1">
          <Button
            type="text"
            size="small"
            className="sidebar-item flex w-full items-center gap-2 px-2.5 text-xs text-foreground"
            onClick={cycleTheme}
            title={themeTitle}
          >
            <ThemeIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
            <span className="truncate">{themeTitle}</span>
          </Button>
        </div>
      </div>

      <CategoryDialog
        state={dialog}
        onSave={handleDialogSave}
        onClose={() => setDialog(null)}
      />

      {deleteConfirm && (
        <div className="dialog-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="dialog-panel w-96" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-foreground">
              {t('sidebar.deleteCategoryConfirm', { name: deleteConfirm.name })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => setDeleteConfirm(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                danger
                onClick={confirmDeleteCategory}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </aside>
  )
}