import type { ReactNode } from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
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
  Loader2,
  LayoutDashboard
} from 'lucide-react'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { useDocumentStore } from '../store/documentStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useTheme } from '../hooks/useTheme'
import type { ListMode, Category, Workspace } from '../../shared/ipc-types'
import SettingsModal from './SettingsModal'
import { Button as UiButton, Input as UiInput } from './ui'
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
  disabled = false,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop
}: {
  icon?: ReactNode
  label: string
  muted?: boolean
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  return (
    <div
      className={`sidebar-item ${
        active ? 'sidebar-item-active' : muted ? 'text-muted' : 'text-foreground'
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}
      onClick={disabled ? undefined : onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (disabled) return
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-label font-semibold uppercase tracking-wide text-muted cursor-context-menu"
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

  const [creatingNew, setCreatingNew] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const newInputRef = useRef<HTMLInputElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingCatImports, setPendingCatImports] = useState<Set<string>>(new Set())
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const selectedIds = useDocumentStore((s) => s.selectedIds)

  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace)
  const chatStreaming = useWorkspaceStore((s) => s.chatStreaming)
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces)
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace)
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace)
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace)

  const [wsCreating, setWsCreating] = useState(false)
  const [wsRenamingId, setWsRenamingId] = useState<string | null>(null)
  const [wsDraftName, setWsDraftName] = useState('')
  const [wsDeleteConfirm, setWsDeleteConfirm] = useState<Workspace | null>(null)
  const wsNewInputRef = useRef<HTMLInputElement>(null)
  const wsRenameInputRef = useRef<HTMLInputElement>(null)
  const wsSubmittingRef = useRef(false)

  const isMac = document.documentElement.dataset.platform === 'mac'

  useEffect(() => {
    void fetchCategories()
    void fetchWorkspaces()
  }, [])

  const handleCategoryClick = useCallback(
    (cat: Category) => {
      setListMode({ mode: 'category', categoryId: cat.id })
    },
    [setListMode]
  )

  const startCreate = useCallback(() => {
    setDraftName('')
    setRenamingId(null)
    setCreatingNew(true)
  }, [])

  const commitCreate = useCallback(async () => {
    if (submittingRef.current) return
    const trimmed = draftName.trim()
    if (!trimmed) {
      setCreatingNew(false)
      setDraftName('')
      return
    }
    submittingRef.current = true
    await createCategory(trimmed)
    setCreatingNew(false)
    setDraftName('')
    submittingRef.current = false
  }, [draftName, createCategory])

  const cancelCreate = useCallback(() => {
    setCreatingNew(false)
    setDraftName('')
  }, [])

  const startRename = useCallback((cat: Category) => {
    setDraftName(cat.name)
    setCreatingNew(false)
    setRenamingId(cat.id)
  }, [])

  const commitRename = useCallback(async (cat: Category) => {
    if (submittingRef.current) return
    const trimmed = draftName.trim()
    if (trimmed && trimmed !== cat.name) {
      submittingRef.current = true
      await renameCategory(cat.id, trimmed)
      submittingRef.current = false
    }
    setRenamingId(null)
    setDraftName('')
  }, [draftName, renameCategory])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
    setDraftName('')
  }, [])

  useEffect(() => {
    if (creatingNew) {
      newInputRef.current?.focus()
    }
  }, [creatingNew])

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renamingId])

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
          onClick: startCreate,
        },
      ]
      showContextMenu(items)
    },
    [t, startCreate]
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
          onClick: startCreate,
        },
        {
          key: 'rename',
          label: t('sidebar.renameCategory'),
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => startRename(cat),
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
    [t, startCreate, startRename, handleDelete]
  )

  const handleDragOverCategory = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes(DOC_MIME) ||
      e.dataTransfer.types.includes('text/plain') ||
      e.dataTransfer.types.includes('Files')
    ) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDropCategory = useCallback(
    async (catId: string, e: React.DragEvent) => {
      const raw = e.dataTransfer.getData(DOC_MIME) || e.dataTransfer.getData('text/plain')
      if (raw) {
        e.preventDefault()
        try {
          let ids: string[] = []
          try {
            const parsed: unknown = JSON.parse(raw)
            if (Array.isArray(parsed)) {
              ids = parsed.filter((v): v is string => typeof v === 'string')
            }
          } catch {
            ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
          }
          if (ids.length === 1) {
            await api.categories.assign(ids[0], catId)
          } else if (ids.length > 1) {
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

  const startWsCreate = useCallback(() => {
    setWsDraftName('')
    setWsRenamingId(null)
    setWsCreating(true)
  }, [])

  const commitWsCreate = useCallback(async () => {
    if (wsSubmittingRef.current) return
    const trimmed = wsDraftName.trim()
    if (!trimmed) {
      setWsCreating(false)
      setWsDraftName('')
      return
    }
    wsSubmittingRef.current = true
    await createWorkspace(trimmed)
    setWsCreating(false)
    setWsDraftName('')
    wsSubmittingRef.current = false
  }, [wsDraftName, createWorkspace])

  const cancelWsCreate = useCallback(() => {
    setWsCreating(false)
    setWsDraftName('')
  }, [])

  const startWsRename = useCallback((ws: Workspace) => {
    setWsDraftName(ws.name)
    setWsCreating(false)
    setWsRenamingId(ws.id)
  }, [])

  const commitWsRename = useCallback(async (ws: Workspace) => {
    if (wsSubmittingRef.current) return
    const trimmed = wsDraftName.trim()
    if (trimmed && trimmed !== ws.name) {
      wsSubmittingRef.current = true
      await renameWorkspace(ws.id, trimmed)
      wsSubmittingRef.current = false
    }
    setWsRenamingId(null)
    setWsDraftName('')
  }, [wsDraftName, renameWorkspace])

  const cancelWsRename = useCallback(() => {
    setWsRenamingId(null)
    setWsDraftName('')
  }, [])

  useEffect(() => {
    if (wsCreating) {
      wsNewInputRef.current?.focus()
    }
  }, [wsCreating])

  useEffect(() => {
    if (wsRenamingId) {
      wsRenameInputRef.current?.focus()
      wsRenameInputRef.current?.select()
    }
  }, [wsRenamingId])

  const handleWsSectionContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const items: ContextMenuItem[] = [
        {
          key: 'create',
          label: t('sidebar.createWorkspace'),
          icon: <Plus className="h-3.5 w-3.5" />,
          onClick: startWsCreate,
        },
      ]
      showContextMenu(items)
    },
    [t, startWsCreate]
  )

  const handleWsItemContext = useCallback(
    (e: React.MouseEvent, ws: Workspace) => {
      e.preventDefault()
      e.stopPropagation()
      const items: ContextMenuItem[] = [
        {
          key: 'create',
          label: t('sidebar.createWorkspace'),
          icon: <Plus className="h-3.5 w-3.5" />,
          onClick: startWsCreate,
        },
        {
          key: 'rename',
          label: t('sidebar.renameWorkspace'),
          icon: <Pencil className="h-3.5 w-3.5" />,
          onClick: () => startWsRename(ws),
        },
        {
          key: 'delete',
          label: t('sidebar.deleteWorkspace'),
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onClick: () => setWsDeleteConfirm(ws),
          danger: true,
        },
      ]
      showContextMenu(items)
    },
    [t, startWsCreate, startWsRename]
  )

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!wsDeleteConfirm) return
    await deleteWorkspace(wsDeleteConfirm.id)
    setWsDeleteConfirm(null)
  }, [wsDeleteConfirm, deleteWorkspace])

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
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleCollapse}
            title={t('settings.sidebarCollapsed')}
            aria-label={t('settings.sidebarCollapsed')}
          >
            <PanelLeftOpen className="h-3.5 w-3.5" />
          </UiButton>
          <div className="toolbar-sep" aria-hidden="true" />
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleAddFiles}
            title={t('topbar.addFile')}
            aria-label={t('topbar.addFile')}
          >
            <FilePlus className="h-3.5 w-3.5" />
          </UiButton>
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleAddFolder}
            title={t('topbar.addFolder')}
            aria-label={t('topbar.addFolder')}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </UiButton>
        </div>
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      </>
    )
  }

  return (
    <aside className="sidebar-floating flex h-full w-full shrink-0 flex-col">
      {/* Header: drag region with action buttons on the right */}
      <div className={`drag-region flex h-12 shrink-0 items-center px-2 ${isMac ? 'pl-[68px]' : ''}`}>
        <div className="ml-auto flex items-center no-drag">
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={handleAddFiles}
            title={t('topbar.addFile')}
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
          <div className="mx-1 h-3.5 w-px bg-border" aria-hidden="true" />
          <UiButton
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleCollapse}
            title={t('settings.sidebarCollapsed')}
            aria-label={t('settings.sidebarCollapsed')}
          >
            <PanelLeftClose className="h-4 w-4" />
          </UiButton>
        </div>
      </div>

      {/* Import progress */}
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

      {/* Background metadata refresh indicator */}
      {!importProgress && pendingMetadataCount > 0 && (
        <div className="mx-2 mb-1 flex items-center gap-2 text-label text-muted">
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
          title={t('sidebar.workspaces')}
          onContextMenu={handleWsSectionContext}
          action={
            <UiButton
              variant="ghost"
              size="sm"
              iconOnly
              className="no-drag -mr-1 text-muted transition-colors duration-150 hover:text-foreground"
              onClick={startWsCreate}
              title={t('sidebar.createWorkspace')}
              aria-label={t('sidebar.createWorkspace')}
            >
              <Plus className="h-3.5 w-3.5" />
            </UiButton>
          }
        >
          {wsCreating && (
            <UiInput
              ref={wsNewInputRef}
              variant="outlined"
              inputSize="sm"
              className="no-drag mb-1"
              placeholder={t('sidebar.workspaceName')}
              value={wsDraftName}
              onChange={(e) => setWsDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commitWsCreate() }
                if (e.key === 'Escape') { e.preventDefault(); cancelWsCreate() }
              }}
              onBlur={() => void commitWsCreate()}
            />
          )}
          {workspaces.length === 0 && !wsCreating ? (
            <div className="px-2 py-1 text-label italic text-muted">
              {t('sidebar.emptyWorkspaces')}
            </div>
          ) : (
            workspaces.map((w) => {
              const isRenaming = wsRenamingId === w.id
              return (
                <div key={w.id} className="relative">
                  {isRenaming ? (
                    <UiInput
                      ref={wsRenameInputRef}
                      variant="outlined"
                      inputSize="sm"
                      className="no-drag"
                      value={wsDraftName}
                      onChange={(e) => setWsDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitWsRename(w) }
                        if (e.key === 'Escape') { e.preventDefault(); cancelWsRename() }
                      }}
                      onBlur={() => void commitWsRename(w)}
                    />
                  ) : (
                    <SidebarItem
                      icon={<LayoutDashboard className="h-4 w-4" />}
                      label={w.name}
                      active={activeWorkspaceId === w.id}
                      disabled={chatStreaming && activeWorkspaceId !== w.id}
                      onClick={() => setActiveWorkspace(w.id)}
                      onContextMenu={(e) => handleWsItemContext(e, w)}
                    />
                  )}
                </div>
              )
            })
          )}
        </SidebarSection>
        <SidebarSection
          title={t('sidebar.categories')}
          onContextMenu={handleSectionContext}
          action={
            <UiButton
              variant="ghost"
              size="sm"
              iconOnly
              className="no-drag -mr-1 text-muted transition-colors duration-150 hover:text-foreground"
              onClick={startCreate}
              title={t('sidebar.createCategory')}
              aria-label={t('sidebar.createCategory')}
            >
              <Plus className="h-3.5 w-3.5" />
            </UiButton>
          }
        >
          {creatingNew && (
            <UiInput
              ref={newInputRef}
              variant="outlined"
              inputSize="sm"
              className="no-drag mb-1"
              placeholder={t('sidebar.categoryName')}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void commitCreate() }
                if (e.key === 'Escape') { e.preventDefault(); cancelCreate() }
              }}
              onBlur={() => void commitCreate()}
            />
          )}
          {categories.length === 0 && !creatingNew ? (
            <div className="px-2 py-1 text-label italic text-muted">
              {t('sidebar.emptyCategories')}
            </div>
          ) : (
            categories.map((c) => {
              const isPending = pendingCatImports.has(c.id)
              const isRenaming = renamingId === c.id
              return (
                <div key={c.id} className="relative">
                  {isRenaming ? (
                    <UiInput
                      ref={renameInputRef}
                      variant="outlined"
                      inputSize="sm"
                      className="no-drag"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitRename(c) }
                        if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                      }}
                      onBlur={() => void commitRename(c)}
                    />
                  ) : (
                    <SidebarItem
                      icon={isPending ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> : undefined}
                      label={`${c.name} (${c.count ?? 0})`}
                      active={listMode.mode === 'category' && listMode.categoryId === c.id}
                      onClick={() => handleCategoryClick(c)}
                      onContextMenu={(e) => handleItemContext(e, c)}
                      onDragOver={handleDragOverCategory}
                      onDrop={(e) => handleDropCategory(c.id, e)}
                    />
                  )}
                  {isPending && !isRenaming && <div className="cat-drop-pulse absolute inset-0" />}
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
          <button
            className="sidebar-item flex w-full items-center gap-2 px-2.5 text-xs text-foreground"
            onClick={cycleTheme}
            title={themeTitle}
          >
            <ThemeIcon className="h-4 w-4 flex-shrink-0 opacity-70" />
            <span className="truncate">{themeTitle}</span>
          </button>
        </div>
      </div>

      {deleteConfirm && (
        <div className="dialog-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="dialog-panel w-96" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-foreground">
              {t('sidebar.deleteCategoryConfirm', { name: deleteConfirm.name })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <UiButton variant="secondary" size="md" onClick={() => setDeleteConfirm(null)}>
                {t('common.cancel')}
              </UiButton>
              <UiButton
                variant="danger"
                size="md"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={confirmDeleteCategory}
              >
                {t('common.delete')}
              </UiButton>
            </div>
          </div>
        </div>
      )}

      {wsDeleteConfirm && (
        <div className="dialog-overlay" onClick={() => setWsDeleteConfirm(null)}>
          <div className="dialog-panel w-96" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-foreground">
              {t('sidebar.deleteWorkspaceConfirm', { name: wsDeleteConfirm.name })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <UiButton variant="secondary" size="md" onClick={() => setWsDeleteConfirm(null)}>
                {t('common.cancel')}
              </UiButton>
              <UiButton
                variant="danger"
                size="md"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={confirmDeleteWorkspace}
              >
                {t('common.delete')}
              </UiButton>
            </div>
          </div>
        </div>
      )}

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </aside>
  )
}