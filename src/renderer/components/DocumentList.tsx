import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState, useCallback } from 'react'
import { ChevronUp, ChevronDown, Star, AlertTriangle, Zap, Check, FileText, FolderOpen, Copy, RefreshCw, Trash2, Search, FolderTree, Plus } from 'lucide-react'
import { Input, showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { useDocumentStore } from '../store/documentStore'
import { api } from '../ipc'
import type { Document, ColumnId, SortField, ListColumn, Category } from '../../shared/ipc-types'

const ROW_HEIGHT = 36
const MIN_COL_WIDTH = 40
const DOC_MIME = 'application/x-scholarnote-docids'

function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatFilePath(path: string): string {
  const home = '/Users/'
  if (path.startsWith(home)) {
    const idx = path.indexOf('/', home.length)
    if (idx !== -1) return '~' + path.slice(idx)
  }
  return path
}

function renderCell(doc: Document, col: ColumnId): string {
  switch (col) {
    case 'title':
      return doc.title || doc.fileName
    case 'authors':
      return doc.authors || '\u2014'
    case 'year':
      return doc.year || '\u2014'
    case 'venue':
      return doc.venue || '\u2014'
    case 'addedAt':
      return formatDate(doc.addedAt)
    case 'filePath':
      return formatFilePath(doc.filePath)
  }
}

function ColumnHeader({
  id,
  label,
  width,
  sortField,
  sortDir,
  onSort,
  onResize,
  onContextMenu
}: {
  id: ColumnId
  label: string
  width: number
  sortField: SortField
  sortDir: 'asc' | 'desc'
  onSort: () => void
  onResize: (id: ColumnId, width: number) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const isSorted = sortField === id
  const startRef = useRef({ x: 0, w: 0 })
  const [dragWidth, setDragWidth] = useState<number | null>(null)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      startRef.current = { x: e.clientX, w: width }

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startRef.current.x
        setDragWidth(Math.max(MIN_COL_WIDTH, startRef.current.w + delta))
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setDragWidth((dw) => {
          const final = dw ?? startRef.current.w
          onResize(id, final)
          return null
        })
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [id, width, onResize]
  )

  const displayWidth = dragWidth ?? width

  return (
    <div
      className="relative flex items-center px-1 font-semibold uppercase tracking-wide text-muted cursor-pointer select-none flex-shrink-0 text-[11px]"
      style={{ width: displayWidth, minWidth: displayWidth }}
      onClick={onSort}
      onContextMenu={onContextMenu}
    >
      <span className="truncate">{label}</span>
      {isSorted && (
        <span className="ml-0.5">
          {sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      )}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleResizeStart}
      />
    </div>
  )
}

function SkeletonRows() {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center px-3" style={{ height: ROW_HEIGHT }}>
          <div className="w-8" />
          <div className="w-8" />
          <div className="w-8" />
          <div className="skeleton-shimmer mx-1 h-3 flex-1 rounded" />
          <div className="skeleton-shimmer mx-1 h-3 rounded" style={{ width: 192 }} />
          <div className="skeleton-shimmer mx-1 h-3 rounded" style={{ width: 64 }} />
          <div className="skeleton-shimmer mx-1 h-3 rounded" style={{ width: 128 }} />
          <div className="skeleton-shimmer mx-1 h-3 rounded" style={{ width: 96 }} />
          <div className="skeleton-shimmer mx-1 h-3 rounded" style={{ width: 192 }} />
        </div>
      ))}
    </div>
  )
}

function visibleColumns(cols: ListColumn[]): ListColumn[] {
  return [...cols].filter((c) => c.visible).sort((a, b) => a.order - b.order)
}

const LABEL_MAP: Record<string, string> = {
  allFiles: 'sidebar.allFiles',
  recentlyRead: 'sidebar.recentlyRead',
  recentlyAdded: 'sidebar.recentlyAdded',
  starred: 'sidebar.starred'
}

interface DocumentListProps {
  sidebarCollapsed?: boolean
}

export default function DocumentList({ sidebarCollapsed = false }: DocumentListProps = {}) {
  const { t } = useTranslation()
  const documents = useDocumentStore((s) => s.documents)
  const isLoading = useDocumentStore((s) => s.isLoading)
  const listColumnState = useDocumentStore((s) => s.listColumnState)
  const listMode = useDocumentStore((s) => s.listMode)
  const selectedIds = useDocumentStore((s) => s.selectedIds)
  const setSort = useDocumentStore((s) => s.setSort)
  const setColumns = useDocumentStore((s) => s.setColumns)
  const toggleSelect = useDocumentStore((s) => s.toggleSelect)
  const setFocusedDoc = useDocumentStore((s) => s.setFocusedDoc)
  const toggleStar = useDocumentStore((s) => s.toggleStar)
  const openPdf = useDocumentStore((s) => s.openPdf)
  const openInFinder = useDocumentStore((s) => s.openInFinder)
  const requestDeleteConfirm = useDocumentStore((s) => s.requestDeleteConfirm)
  const refreshMetadata = useDocumentStore((s) => s.refreshMetadata)
  const isSearching = useDocumentStore((s) => s.isSearching)
  const searchResults = useDocumentStore((s) => s.searchResults)
  const searchQuery = useDocumentStore((s) => s.searchQuery)
  const performSearch = useDocumentStore((s) => s.performSearch)
  const clearSearch = useDocumentStore((s) => s.clearSearch)
  const categories = useDocumentStore((s) => s.categories)
  const createCategory = useDocumentStore((s) => s.createCategory)
  const fetchDocuments = useDocumentStore((s) => s.fetchDocuments)

  const parentRef = useRef<HTMLDivElement>(null)

  const cols = visibleColumns(listColumnState.columns)

  const displayDocs = isSearching ? searchResults : documents

  const virtualizer = useVirtualizer({
    count: displayDocs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5
  })

  const headerLabel = isSearching
    ? `${t('topbar.search')}: ${isLoading ? '' : displayDocs.length}`
    : `${t(LABEL_MAP[listMode.mode] ?? 'sidebar.allFiles')} · ${documents.length}`

  const toggleColumn = useCallback(
    (id: ColumnId) => {
      const updated = listColumnState.columns.map((c) =>
        c.id === id ? { ...c, visible: !c.visible } : c
      )
      setColumns(updated)
    },
    [listColumnState.columns, setColumns]
  )

  const handleResize = useCallback(
    (id: ColumnId, width: number) => {
      const updated = listColumnState.columns.map((c) =>
        c.id === id ? { ...c, width } : c
      )
      setColumns(updated)
    },
    [listColumnState.columns, setColumns]
  )

  const handleRowClick = useCallback(
    (docId: string, e: React.MouseEvent) => {
      e.preventDefault()
      setFocusedDoc(docId)
    },
    [setFocusedDoc]
  )

  const handleCopyPath = useCallback((filePath: string) => {
    navigator.clipboard.writeText(filePath).catch(() => {})
  }, [])

  const handleRowContextMenu = useCallback(
    (doc: Document, e: React.MouseEvent) => {
      e.preventDefault()
      const effectiveIds =
        selectedIds.length > 0 && selectedIds.includes(doc.id) ? selectedIds : [doc.id]
      const assignToCategory = async (catId: string) => {
        try {
          if (effectiveIds.length === 1) {
            await api.categories.assign(effectiveIds[0], catId)
          } else {
            await api.documents.bulkCategorize(effectiveIds, catId)
          }
          void useDocumentStore.getState().fetchCategories()
        } catch (err) {
          const msg = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Failed to categorize'
          useDocumentStore.getState().showToast(msg)
        }
      }
      const createAndAssign = async () => {
        const name = window.prompt(t('sidebar.categoryName'))
        if (!name || !name.trim()) return
        const cat = await createCategory(name.trim())
        if (cat) await assignToCategory(cat.id)
      }

      const categoryItems: ContextMenuItem[] = categories.length
        ? categories.map((c: Category) => ({
            key: `cat-${c.id}`,
            label: `${c.name} (${c.count ?? 0})`,
            onClick: () => { void assignToCategory(c.id) },
          }))
        : [{
            key: 'no-categories',
            label: t('sidebar.emptyCategories'),
            disabled: true,
            onClick: () => {},
          }]

      const items: ContextMenuItem[] = [
        {
          key: 'addToCategory',
          label: t('sidebar.addToCategory'),
          icon: <FolderTree className="h-3.5 w-3.5" />,
          type: 'submenu',
          children: [
            ...categoryItems,
            { type: 'divider' as const, key: 'cat-divider' },
            {
              key: 'create-category',
              label: t('sidebar.createCategory'),
              icon: <Plus className="h-3.5 w-3.5" />,
              onClick: () => { void createAndAssign() },
            },
          ],
        },
        { type: 'divider' as const, key: 'divider-1' },
        {
          key: 'openInFinder',
          label: t('common.openInFinder'),
          icon: <FolderOpen className="h-3.5 w-3.5" />,
          onClick: () => openInFinder(doc.id),
        },
        {
          key: 'copyPath',
          label: t('common.copyPath'),
          icon: <Copy className="h-3.5 w-3.5" />,
          onClick: () => handleCopyPath(doc.filePath),
        },
        {
          key: 'refreshMetadata',
          label: t('detail.refreshMetadata'),
          icon: <RefreshCw className="h-3.5 w-3.5" />,
          onClick: () => refreshMetadata(doc.id),
        },
        {
          key: 'delete',
          label: t('common.delete'),
          icon: <Trash2 className="h-3.5 w-3.5" />,
          onClick: () => requestDeleteConfirm([doc.id], t('dialog.deleteConfirm')),
          danger: true,
        },
      ]
      showContextMenu(items)
    },
    [t, openInFinder, handleCopyPath, refreshMetadata, requestDeleteConfirm, selectedIds, categories, createCategory]
  )

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    const files = e.dataTransfer.files
    if (files.length === 0) return
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
    if (paths.length > 0) {
      try {
        await api.import.addFiles(paths)
      } catch { void 0 }
      void fetchDocuments()
    }
  }, [fetchDocuments])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragStart = useCallback(
    (docId: string, e: React.DragEvent) => {
      const ids = selectedIds.length > 0 && selectedIds.includes(docId) ? selectedIds : [docId]
      e.dataTransfer.setData(DOC_MIME, JSON.stringify(ids))
      e.dataTransfer.effectAllowed = 'move'
    },
    [selectedIds]
  )

  const sortedColumns = [...listColumnState.columns].sort((a, b) => a.order - b.order)

  const handleColContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const colItems: ContextMenuItem[] = sortedColumns.map((col) => ({
        key: col.id,
        label: t(`list.${col.id}` as never),
        icon: col.visible ? <Check className="h-3.5 w-3.5" /> : <span className="inline-block w-[14px]" />,
        onClick: () => toggleColumn(col.id),
      }))
      showContextMenu(colItems)
    },
    [sortedColumns, t, toggleColumn]
  )

  const colHeaderBar =
    cols.length > 0 ? (
      <div className="flex border-b border-border bg-panel-2">
        <div className="w-8 flex-shrink-0" />
        <div className="w-8 flex-shrink-0" />
        <div className="w-8 flex-shrink-0" />
        {cols.map((col) => (
          <ColumnHeader
            key={col.id}
            id={col.id}
            label={t(`list.${col.id}` as never)}
            width={col.width}
            sortField={listColumnState.sort.field}
            sortDir={listColumnState.sort.dir}
            onSort={() => setSort(col.id)}
            onResize={handleResize}
            onContextMenu={handleColContextMenu}
          />
        ))}
      </div>
    ) : null

  return (
    <div
      className="flex min-w-0 flex-1 flex-col bg-background"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex h-14 items-center gap-2 border-b border-border drag-region">
        {sidebarCollapsed && (
          <div
            className="no-drag self-stretch shrink-0"
            aria-hidden="true"
            style={{ width: 'var(--toolbar-preserve, 168px)' }}
          />
        )}
        <div className="mx-auto flex items-center gap-[10px]">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted no-drag" />
          <Input
            className="doc-search-input w-[280px] no-drag"
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
          {isSearching ? (
            <span className="shrink-0 text-sm text-muted">
              {isLoading ? '' : `${displayDocs.length} ${t('common.results')}`}
            </span>
          ) : (
            <span className="shrink-0 text-sm text-muted font-medium whitespace-nowrap">{headerLabel}</span>
          )}
        </div>
      </div>

      {colHeaderBar}

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <SkeletonRows />
        ) : displayDocs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-xs text-muted">
            {isSearching ? t('common.noSearchResults') : t('common.emptyLibrary')}
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative'
            }}
          >
            {virtualizer.getVirtualItems().map((vr) => {
              const doc = displayDocs[vr.index]
              const isSelected = selectedIds.includes(doc.id)
              const isMissing = doc.fileMissing === 1
              const isFailed = doc.metadataStatus === 'failed'
              const hasError = isMissing || isFailed

              return (
                <div
                  key={vr.key}
                  data-index={vr.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vr.start}px)`
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(doc.id, e)}
                  onContextMenu={(e) => handleRowContextMenu(doc, e)}
                >
                  <div
                    className={`flex items-center px-3 text-xs cursor-pointer ${
                      isSelected ? 'bg-active' : 'hover:bg-hover'
                    }`}
                    style={{ height: ROW_HEIGHT }}
                    onClick={(e) => handleRowClick(doc.id, e)}
                  >
                    <div className="w-8 flex-shrink-0 flex items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-3 w-3 rounded border-border bg-background accent-accent cursor-pointer"
                        checked={isSelected}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleSelect(doc.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    <div className="w-8 flex-shrink-0 flex items-center justify-center text-center">
                      {isMissing ? (
                        <span title={t('detail.relocate') ?? 'Relocate'}>
                          <AlertTriangle className="h-4 w-4 text-warning" />
                        </span>
                      ) : (
                        <button
                          className="flex items-center justify-center text-accent hover:text-accent-hover cursor-pointer"
                          title={t('detail.open')}
                          aria-label={t('detail.open')}
                          onClick={(e) => {
                            e.stopPropagation()
                            openPdf(doc.id)
                          }}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="w-8 flex-shrink-0 text-center">
                      <button
                        className="cursor-pointer"
                        title={t('sidebar.starred')}
                        aria-label={t('sidebar.starred')}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStar(doc.id)
                        }}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            doc.starred ? 'fill-yellow-400 text-yellow-400' : 'text-muted'
                          }`}
                        />
                      </button>
                    </div>
                    {cols.map((col) => (
                      <div
                        key={col.id}
                        className="truncate px-1"
                        style={{ width: col.width, flexShrink: 0 }}
                      >
                        {col.id === 'title' ? (
                          <span className={`${isMissing ? 'text-muted' : 'text-foreground'}`}>
                            {renderCell(doc, col.id)}
                          </span>
                        ) : (
                          <span className="text-muted">{renderCell(doc, col.id)}</span>
                        )}
                      </div>
                    ))}
                    {hasError && !isMissing && (
                      <div className="ml-1 flex-shrink-0" title={`${t('common.networkError')} (${doc.metadataAttempts})`}>
                        <Zap className="h-3.5 w-3.5 text-error" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
