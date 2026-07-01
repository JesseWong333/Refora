import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useDocumentStore } from '../store/documentStore'
import { api } from '../ipc'
import type { Document, ColumnId, SortField, ListColumn } from '../../shared/ipc-types'

const ROW_HEIGHT = 28
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
        <span className="ml-0.5 text-[10px] leading-none">
          {sortDir === 'asc' ? '\u25B2' : '\u25BC'}
        </span>
      )}
      <div
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent"
        onMouseDown={handleResizeStart}
      />
    </div>
  )
}

function ColumnContextMenu({
  x,
  y,
  columns,
  onToggle,
  onClose
}: {
  x: number
  y: number
  columns: ListColumn[]
  onToggle: (id: ColumnId) => void
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

  const sorted = [...columns].sort((a, b) => a.order - b.order)

  return createPortal(
    <div
      className="fixed z-50 min-w-[160px] rounded border border-border bg-panel py-1 shadow-lg"
      style={{ left: x, top: y, maxHeight: '80vh', overflowY: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {sorted.map((col) => (
        <div
          key={col.id}
          className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-hover"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(col.id)
            onClose()
          }}
        >
          <span className="w-4 text-center">{col.visible ? '\u2713' : ''}</span>
          <span>{t(`list.${col.id}` as never)}</span>
        </div>
      ))}
    </div>,
    document.body
  )
}

function RowContextMenu({
  x,
  y,
  onOpenInFinder,
  onCopyPath,
  onRefreshMetadata,
  onDelete,
  onClose
}: {
  x: number
  y: number
  onOpenInFinder: () => void
  onCopyPath: () => void
  onRefreshMetadata: () => void
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

  const items = [
    { label: t('common.openInFinder'), action: onOpenInFinder },
    { label: t('common.copyPath'), action: onCopyPath },
    { label: t('detail.refreshMetadata'), action: onRefreshMetadata },
    { label: t('common.delete'), action: onDelete, danger: true }
  ]

  return createPortal(
    <div
      className="fixed z-50 min-w-[180px] rounded border border-border bg-panel py-1 shadow-lg"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className={`cursor-pointer px-3 py-1.5 text-xs hover:bg-hover ${
            item.danger ? 'text-error' : 'text-foreground'
          }`}
          onClick={(e) => {
            e.stopPropagation()
            item.action()
            onClose()
          }}
        >
          {item.label}
        </div>
      ))}
    </div>,
    document.body
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

export default function DocumentList() {
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

  const parentRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; docId: string; filePath: string } | null>(null)
  const [colCtxMenu, setColCtxMenu] = useState<{ x: number; y: number } | null>(null)

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

  const handleRowContextMenu = useCallback(
    (doc: Document, e: React.MouseEvent) => {
      e.preventDefault()
      setCtxMenu({ x: e.clientX, y: e.clientY, docId: doc.id, filePath: doc.filePath })
    },
    []
  )

  const handleCopyPath = useCallback((filePath: string) => {
    navigator.clipboard.writeText(filePath).catch(() => {})
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    const files = e.dataTransfer.files
    if (files.length === 0) return
    e.preventDefault()
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i] as File & { path?: string }
      if (f.path && f.path.toLowerCase().endsWith('.pdf')) {
        paths.push(f.path)
      }
    }
    if (paths.length > 0) {
      api.import.addFiles(paths).catch(() => {})
    }
  }, [])

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
            onContextMenu={(e) => {
              e.preventDefault()
              setColCtxMenu({ x: e.clientX, y: e.clientY })
            }}
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
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
        {headerLabel}
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
                        <span
                          className="text-xs text-warning cursor-default"
                          title={t('detail.relocate') ?? 'Relocate'}
                        >
                          {'\u26A0'}
                        </span>
                      ) : (
                        <button
                          className="text-[10px] font-bold text-accent hover:text-accent-hover cursor-pointer"
                          title={t('detail.open')}
                          aria-label={t('detail.open')}
                          onClick={(e) => {
                            e.stopPropagation()
                            openPdf(doc.id)
                          }}
                        >
                          PDF
                        </button>
                      )}
                    </div>
                    <div className="w-8 flex-shrink-0 text-center">
                      <button
                        className="text-sm cursor-pointer"
                        title={t('sidebar.starred')}
                        aria-label={t('sidebar.starred')}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleStar(doc.id)
                        }}
                      >
                        {doc.starred ? '\u2605' : '\u2606'}
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
                        <span className="text-[10px] text-error">{'\u26A1'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {colCtxMenu && (
        <ColumnContextMenu
          x={colCtxMenu.x}
          y={colCtxMenu.y}
          columns={listColumnState.columns}
          onToggle={toggleColumn}
          onClose={() => setColCtxMenu(null)}
        />
      )}

      {ctxMenu && (
        <RowContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onOpenInFinder={() => openInFinder(ctxMenu.docId)}
          onCopyPath={() => handleCopyPath(ctxMenu.filePath)}
          onRefreshMetadata={() => refreshMetadata(ctxMenu.docId)}
          onDelete={() => requestDeleteConfirm([ctxMenu.docId], t('dialog.deleteConfirm'))}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
