import type { ReactNode } from 'react'
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDocumentStore } from '../store/documentStore'
import type { ListMode, Category } from '../../shared/ipc-types'
import CategoryDialog from './CategoryDialog'
import type { CategoryDialogState } from './CategoryDialog'
import { api } from '../ipc'

const DOC_MIME = 'application/x-scholarnote-docids'

interface SidebarProps {
  collapsed: boolean
}

const SMART_ITEMS: { key: string; mode: ListMode }[] = [
  { key: 'allFiles', mode: 'all' },
  { key: 'recentlyRead', mode: 'recentlyRead' },
  { key: 'recentlyAdded', mode: 'recentlyAdded' },
  { key: 'starred', mode: 'starred' }
]

function SidebarItem({
  label,
  muted = false,
  active = false,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop
}: {
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
      className={`cursor-pointer truncate rounded px-2 py-1 hover:bg-hover ${
        active ? 'bg-active text-foreground' : muted ? 'text-muted' : 'text-foreground'
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
      {label}
    </div>
  )
}

function SidebarSection({
  title,
  onContextMenu,
  children
}: {
  title: string
  onContextMenu?: (e: React.MouseEvent) => void
  children: ReactNode
}) {
  return (
    <div className="mb-3">
      <div
        className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted cursor-context-menu"
        onContextMenu={onContextMenu}
      >
        {title}
      </div>
      <div className="px-1">{children}</div>
    </div>
  )
}

function CategoryContextMenu({
  x,
  y,
  category,
  onCreate,
  onRename,
  onDelete,
  onClose
}: {
  x: number
  y: number
  category?: Category
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const handle = (_e: MouseEvent) => onClose()
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    setTimeout(() => {
      document.addEventListener('click', handle)
      document.addEventListener('keydown', handleKey)
    }, 0)
    return () => {
      document.removeEventListener('click', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed z-50 min-w-[160px] rounded border border-border bg-panel py-1 shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="cursor-pointer px-3 py-1.5 text-xs text-foreground hover:bg-hover"
        onClick={() => {
          onCreate()
          onClose()
        }}
      >
        {t('sidebar.createCategory')}
      </div>
      {category && (
        <>
          <div
            className="cursor-pointer px-3 py-1.5 text-xs text-foreground hover:bg-hover"
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            {t('sidebar.renameCategory')}
          </div>
          <div
            className="cursor-pointer px-3 py-1.5 text-xs text-error hover:bg-hover"
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            {t('sidebar.deleteCategory')}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}

export default function Sidebar({ collapsed }: SidebarProps) {
  const { t } = useTranslation()
  const listMode = useDocumentStore((s) => s.listMode)
  const setListMode = useDocumentStore((s) => s.setListMode)
  const categories = useDocumentStore((s) => s.categories)
  const fetchCategories = useDocumentStore((s) => s.fetchCategories)
  const createCategory = useDocumentStore((s) => s.createCategory)
  const renameCategory = useDocumentStore((s) => s.renameCategory)
  const deleteCategory = useDocumentStore((s) => s.deleteCategory)
  const focusedDocId = useDocumentStore((s) => s.focusedDocId)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; category?: Category } | null>(null)
  const [dialog, setDialog] = useState<CategoryDialogState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)
  const [folderGroups, setFolderGroups] = useState<Array<{ path: string; count: number }>>([])

  useEffect(() => {
    void fetchCategories()
    api.documents.folderGroups().then(setFolderGroups).catch(() => {})
  }, [])

  useEffect(() => {
    const cb = () => {
      api.documents.folderGroups().then(setFolderGroups).catch(() => {})
    }
    api.events.onDocumentUpdated(cb)
    return () => {
      api.events.off('document:updated', cb)
    }
  }, [])

  const handleCategoryClick = useCallback(
    (cat: Category) => {
      setListMode({ mode: 'category', categoryId: cat.id })
    },
    [setListMode]
  )

  const handleSectionContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setCtxMenu({ x: e.clientX, y: e.clientY })
    },
    []
  )

  const handleItemContext = useCallback(
    (e: React.MouseEvent, cat: Category) => {
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu({ x: e.clientX, y: e.clientY, category: cat })
    },
    []
  )

  const handleDragOverCategory = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DOC_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const handleDropCategory = useCallback(
    (catId: string, e: React.DragEvent) => {
      e.preventDefault()
      const raw = e.dataTransfer.getData(DOC_MIME)
      if (!raw) return
      try {
        const ids: string[] = JSON.parse(raw)
        if (ids.length === 1) {
          api.categories.assign(ids[0], catId).catch(() => {})
        } else {
          api.documents.bulkCategorize(ids, catId).catch(() => {})
        }
        void fetchCategories()
      } catch {
        void 0
      }
    },
    [fetchCategories]
  )

  const handleCreate = useCallback(() => {
    setCtxMenu(null)
    setDialog({ mode: 'create' })
  }, [])

  const handleRename = useCallback(() => {
    if (!ctxMenu?.category) return
    setDialog({ mode: 'rename', category: ctxMenu.category })
    setCtxMenu(null)
  }, [ctxMenu])

  const handleDelete = useCallback(() => {
    if (!ctxMenu?.category) return
    setDeleteConfirm(ctxMenu.category)
    setCtxMenu(null)
  }, [ctxMenu])

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
    async (name: string, moveToLibrary: number | null) => {
      if (dialog?.mode === 'create') {
        await createCategory(name, moveToLibrary ?? undefined)
      } else if (dialog?.mode === 'rename' && dialog.category) {
        await renameCategory(dialog.category.id, name)
        if (moveToLibrary !== dialog.category.moveToLibrary) {
          try {
            await api.categories.setMoveToLibrary(dialog.category.id, moveToLibrary)
            void fetchCategories()
          } catch {
            void 0
          }
        }
      }
    },
    [dialog, createCategory, renameCategory, fetchCategories]
  )

  if (collapsed) {
    return <div className="w-12 shrink-0 border-r border-border bg-panel" />
  }

  return (
    <div className="w-56 shrink-0 overflow-y-auto border-r border-border bg-panel">
      <nav className="py-2">
        <div className="mb-3 px-1">
          {SMART_ITEMS.map((item) => (
            <SidebarItem
              key={item.key}
              label={t(`sidebar.${item.key}`)}
              active={listMode.mode === item.mode}
              onClick={() => setListMode({ mode: item.mode })}
            />
          ))}
        </div>
        <SidebarSection
          title={t('sidebar.categories')}
          onContextMenu={handleSectionContext}
        >
          {categories.length === 0 ? (
            <div className="px-2 py-1 text-[11px] italic text-muted">
              {t('sidebar.emptyCategories')}
            </div>
          ) : (
            categories.map((c) => (
              <SidebarItem
                key={c.id}
                label={`${c.name} (${c.count ?? 0})`}
                active={listMode.mode === 'category' && listMode.categoryId === c.id}
                onClick={() => handleCategoryClick(c)}
                onContextMenu={(e) => handleItemContext(e, c)}
                onDragOver={handleDragOverCategory}
                onDrop={(e) => handleDropCategory(c.id, e)}
              />
            ))
          )}
        </SidebarSection>
        <SidebarSection title={t('sidebar.folderGrouping')}>
          {folderGroups.length === 0 ? (
            <div className="px-2 py-1 text-[11px] italic text-muted">
              {t('sidebar.emptyCategories')}
            </div>
          ) : (
            folderGroups.map((fg) => (
              <SidebarItem
                key={fg.path}
                label={`\uD83D\uDCC1 ${fg.path} (${fg.count})`}
                muted
                active={listMode.mode === 'folder' && listMode.folderPath === fg.path}
                onClick={() => setListMode({ mode: 'folder', folderPath: fg.path })}
              />
            ))
          )}
        </SidebarSection>
      </nav>

      {ctxMenu && (
        <CategoryContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          category={ctxMenu.category}
          onCreate={handleCreate}
          onRename={handleRename}
          onDelete={handleDelete}
          onClose={() => setCtxMenu(null)}
        />
      )}

      <CategoryDialog
        state={dialog}
        onSave={handleDialogSave}
        onSetMoveToLibrary={async (catId, value) => {
          try {
            await api.categories.setMoveToLibrary(catId, value)
            void fetchCategories()
          } catch {
            void 0
          }
        }}
        onClose={() => setDialog(null)}
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-96 rounded border border-border bg-panel p-4 shadow-lg">
            <p className="text-sm text-foreground">
              {t('sidebar.deleteCategoryConfirm', { name: deleteConfirm.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded bg-panel-2 px-3 py-1.5 text-xs text-foreground hover:bg-hover"
                onClick={() => setDeleteConfirm(null)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="rounded bg-error px-3 py-1.5 text-xs text-white hover:opacity-90"
                onClick={confirmDeleteCategory}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
