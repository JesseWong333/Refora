import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { FilePlus, NotePencil, Sticker } from '@phosphor-icons/react'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { useDocumentStore } from '../../store/documentStore'
import { api } from '../../ipc'
import { Button, EmptyState } from '../ui'
import {
  WORKSPACE_CANVAS_DEFAULT_ZOOM,
  WORKSPACE_CANVAS_MAX_ZOOM,
  WORKSPACE_CANVAS_MIN_ZOOM,
  errorMessage
} from '../../../shared/ipc-types'
import type {
  AiSummary,
  Document,
  SummaryErrorEvent,
  WorkspaceCanvasViewport,
  WorkspaceItem,
  WorkspaceItemPlacement,
  WorkspaceNote,
  WorkspaceNoteType
} from '../../../shared/ipc-types'
import PaperCard from './PaperCard'
import ReportCard from './ReportCard'
import NoteCard from './NoteCard'
import StickyNoteCard from './StickyNoteCard'
import ResizableCard, {
  clampCardSize,
  type CardPosition,
  type CardSize
} from './ResizableCard'

const DOC_MIME = 'application/x-refora-docids'
const GRID_SIZE = 32
const VIEWPORT_SAVE_DELAY = 160
const EMPTY_NOTES: WorkspaceNote[] = []
const DEFAULT_VIEWPORT: WorkspaceCanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: WORKSPACE_CANVAS_DEFAULT_ZOOM
}

function clampZoom(zoom: number): number {
  return Math.max(WORKSPACE_CANVAS_MIN_ZOOM, Math.min(WORKSPACE_CANVAS_MAX_ZOOM, zoom))
}

export interface BoardHandle {
  createNote: (noteType: WorkspaceNoteType) => void
}

const Board = forwardRef<BoardHandle>(function Board(_, ref) {
  const { t } = useTranslation()
  const items = useWorkspaceStore((s) => s.items)
  const reports = useWorkspaceStore((s) => s.reports)
  const notes = useWorkspaceStore((s) => s.notes) ?? EMPTY_NOTES
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const addDocs = useWorkspaceStore((s) => s.addDocs)
  const removeItem = useWorkspaceStore((s) => s.removeItem)
  const resizeItem = useWorkspaceStore((s) => s.resizeItem)
  const moveItem = useWorkspaceStore((s) => s.moveItem)
  const createNote = useWorkspaceStore((s) => s.createNote)
  const deleteNote = useWorkspaceStore((s) => s.deleteNote)
  const updateNote = useWorkspaceStore((s) => s.updateNote)
  const deleteReport = useWorkspaceStore((s) => s.deleteReport)
  const updateReport = useWorkspaceStore((s) => s.updateReport)

  const [docs, setDocs] = useState<Map<string, Document>>(new Map())
  const [summaries, setSummaries] = useState<Map<string, AiSummary>>(new Map())
  const [summarizing, setSummarizing] = useState<Set<string>>(new Set())
  const [summaryErrors, setSummaryErrors] = useState<Map<string, string>>(new Map())
  const [dropActive, setDropActive] = useState(false)
  const [cardSizes, setCardSizes] = useState<Record<string, CardSize>>({})
  const [cardPositions, setCardPositions] = useState<Record<string, CardPosition>>({})
  const [autoEditNoteId, setAutoEditNoteId] = useState<string | null>(null)
  const [autoEditStickyNoteId, setAutoEditStickyNoteId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<WorkspaceCanvasViewport>(DEFAULT_VIEWPORT)
  const [panning, setPanning] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<WorkspaceCanvasViewport>(DEFAULT_VIEWPORT)
  const viewportTouchedRef = useRef(false)
  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panCleanupRef = useRef<(() => void) | null>(null)

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.zIndex - b.zIndex || a.addedAt - b.addedAt),
    [items]
  )
  const reportMap = useMemo(() => new Map(reports.map((report) => [report.id, report])), [reports])
  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const workspaceDocIds = useMemo(
    () => sortedItems
      .filter((item) => item.kind === 'document' && item.docId)
      .map((item) => item.docId as string),
    [sortedItems]
  )
  const allDocIds = useMemo(
    () => [...new Set([...workspaceDocIds, ...reports.flatMap((report) => report.sourceDocIds)])],
    [reports, workspaceDocIds]
  )
  const allDocIdsKey = allDocIds.join('|')
  const workspaceDocIdsKey = workspaceDocIds.join('|')
  const maxZIndex = useMemo(
    () => sortedItems.reduce(
      (maximum, item) => Math.max(maximum, cardPositions[item.id]?.zIndex ?? item.zIndex),
      -1
    ),
    [cardPositions, sortedItems]
  )

  const persistViewport = useCallback((workspaceId: string, next: WorkspaceCanvasViewport) => {
    void api.workspaceCanvas.update(workspaceId, next).catch((e) => {
      if (useWorkspaceStore.getState().activeWorkspaceId === workspaceId) {
        useDocumentStore.getState().showToast(errorMessage(e, t('workspace.canvasSaveFailed')))
      }
    })
  }, [t])

  const scheduleViewportSave = useCallback((next: WorkspaceCanvasViewport) => {
    if (!activeWorkspaceId) return
    if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current)
    const workspaceId = activeWorkspaceId
    viewportSaveTimerRef.current = setTimeout(() => {
      viewportSaveTimerRef.current = null
      persistViewport(workspaceId, next)
    }, VIEWPORT_SAVE_DELAY)
  }, [activeWorkspaceId, persistViewport])

  const updateViewport = useCallback((next: WorkspaceCanvasViewport, save = true) => {
    viewportTouchedRef.current = true
    viewportRef.current = next
    setViewport(next)
    if (save) scheduleViewportSave(next)
  }, [scheduleViewportSave])

  useEffect(() => {
    setDocs(new Map())
    setSummaries(new Map())
    setSummarizing(new Set())
    setSummaryErrors(new Map())
    setCardSizes({})
    setCardPositions({})
    setAutoEditNoteId(null)
    setAutoEditStickyNoteId(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current)
      viewportSaveTimerRef.current = null
    }
    viewportTouchedRef.current = false
    viewportRef.current = DEFAULT_VIEWPORT
    setViewport(DEFAULT_VIEWPORT)
    if (!activeWorkspaceId) return
    const workspaceId = activeWorkspaceId
    let cancelled = false
    void api.workspaceCanvas.get(workspaceId).then((saved) => {
      if (cancelled || viewportTouchedRef.current) return
      viewportRef.current = saved
      setViewport(saved)
    }).catch((e) => {
      if (!cancelled) {
        useDocumentStore.getState().showToast(errorMessage(e, t('workspace.canvasLoadFailed')))
      }
    })
    return () => {
      cancelled = true
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current)
        viewportSaveTimerRef.current = null
      }
      if (viewportTouchedRef.current) persistViewport(workspaceId, viewportRef.current)
    }
  }, [activeWorkspaceId, persistViewport, t])

  useEffect(() => {
    return () => {
      if (dropErrorTimerRef.current) clearTimeout(dropErrorTimerRef.current)
      panCleanupRef.current?.()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const workspaceIds = new Set(workspaceDocIds)
    void Promise.all(
      allDocIds.map(async (docId) => {
        try {
          const [doc, summary] = await Promise.all([
            api.documents.get(docId),
            workspaceIds.has(docId) ? api.ai.summaryGet(docId) : Promise.resolve(null)
          ])
          if (cancelled) return
          setDocs((previous) => {
            if (!doc) return previous
            const next = new Map(previous)
            next.set(docId, doc)
            return next
          })
          if (workspaceIds.has(docId)) {
            setSummaries((previous) => {
              const next = new Map(previous)
              if (summary) next.set(docId, summary)
              else next.delete(docId)
              return next
            })
          }
        } catch (e) {
          if (cancelled) return
          useDocumentStore.getState().showToast(errorMessage(e, 'Failed to load workspace document'))
          if (workspaceIds.has(docId)) {
            setSummaryErrors((previous) => new Map(previous).set(docId, 'Failed to load document'))
          }
        }
      })
    )
    return () => {
      cancelled = true
    }
  }, [allDocIdsKey, workspaceDocIdsKey])

  useEffect(() => {
    const cb = (docId: string) => {
      if (!workspaceDocIds.includes(docId)) return
      void api.ai.summaryGet(docId).then((summary) => {
        setSummaries((previous) => {
          const next = new Map(previous)
          if (summary) next.set(docId, summary)
          else next.delete(docId)
          return next
        })
        setSummarizing((previous) => {
          if (!previous.has(docId)) return previous
          const next = new Set(previous)
          next.delete(docId)
          return next
        })
      })
    }
    const errCb = (payload: SummaryErrorEvent) => {
      if (!workspaceDocIds.includes(payload.docId)) return
      setSummarizing((previous) => {
        if (!previous.has(payload.docId)) return previous
        const next = new Set(previous)
        next.delete(payload.docId)
        return next
      })
      setSummaryErrors((previous) => new Map(previous).set(payload.docId, payload.message))
    }
    api.events.onAiSummaryUpdated(cb)
    api.events.onAiSummaryError(errCb)
    return () => {
      api.events.off('ai:summary:updated', cb)
      api.events.off('ai:summary:error', errCb)
    }
  }, [workspaceDocIdsKey])

  const handleSummarize = (docId: string) => {
    setSummaryErrors((previous) => {
      const next = new Map(previous)
      next.delete(docId)
      return next
    })
    setSummarizing((previous) => new Set(previous).add(docId))
    api.ai.summarize(docId).catch((e) => {
      setSummarizing((previous) => {
        const next = new Set(previous)
        next.delete(docId)
        return next
      })
      setSummaryErrors((previous) => new Map(previous).set(docId, errorMessage(e, t('workspace.summaryFailed'))))
    })
  }

  const handleCardSizeChange = useCallback((itemId: string, size: CardSize) => {
    setCardSizes((previous) => ({ ...previous, [itemId]: clampCardSize(size) }))
  }, [])

  const handleCardSizeCommit = useCallback((itemId: string, size: CardSize) => {
    const clamped = clampCardSize(size)
    void resizeItem(itemId, clamped.width, clamped.height).then(() => {
      setCardSizes((previous) => {
        const next = { ...previous }
        delete next[itemId]
        return next
      })
    })
  }, [resizeItem])

  const handleCardPositionChange = useCallback((itemId: string, position: CardPosition) => {
    setCardPositions((previous) => ({ ...previous, [itemId]: position }))
  }, [])

  const handleCardPositionCommit = useCallback((itemId: string, position: CardPosition) => {
    void moveItem(itemId, position.x, position.y, position.zIndex).then(() => {
      setCardPositions((previous) => {
        const next = { ...previous }
        delete next[itemId]
        return next
      })
    })
  }, [moveItem])

  const sizeFor = useCallback((item: WorkspaceItem): CardSize =>
    cardSizes[item.id] ?? clampCardSize({ width: item.width, height: item.height }), [cardSizes])

  const positionFor = useCallback((item: WorkspaceItem): CardPosition =>
    cardPositions[item.id] ?? { x: item.x, y: item.y, zIndex: item.zIndex }, [cardPositions])

  const worldPositionAt = useCallback((clientX: number, clientY: number): WorkspaceItemPlacement => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const current = viewportRef.current
    return {
      x: (clientX - rect.left - current.panX) / current.zoom,
      y: (clientY - rect.top - current.panY) / current.zoom
    }
  }, [])

  const placementAtCanvasCenter = useCallback((): WorkspaceItemPlacement => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const center = worldPositionAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return { x: Math.round(center.x - 150), y: Math.round(center.y - 100) }
  }, [worldPositionAt])

  const applyZoomAt = useCallback((zoom: number, clientX?: number, clientY?: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const current = viewportRef.current
    const nextZoom = clampZoom(zoom)
    const anchorX = (clientX ?? rect.left + rect.width / 2) - rect.left
    const anchorY = (clientY ?? rect.top + rect.height / 2) - rect.top
    const worldX = (anchorX - current.panX) / current.zoom
    const worldY = (anchorY - current.panY) / current.zoom
    updateViewport({
      panX: anchorX - worldX * nextZoom,
      panY: anchorY - worldY * nextZoom,
      zoom: nextZoom
    })
  }, [updateViewport])

  const resetViewport = useCallback(() => {
    updateViewport(DEFAULT_VIEWPORT)
  }, [updateViewport])

  const fitAll = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || sortedItems.length === 0) {
      resetViewport()
      return
    }
    const bounds = sortedItems.reduce((current, item) => {
      const position = positionFor(item)
      const size = sizeFor(item)
      return {
        minX: Math.min(current.minX, position.x),
        minY: Math.min(current.minY, position.y),
        maxX: Math.max(current.maxX, position.x + size.width),
        maxY: Math.max(current.maxY, position.y + size.height)
      }
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX)
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY)
    const zoom = clampZoom(Math.min(1, (rect.width - 96) / contentWidth, (rect.height - 96) / contentHeight))
    updateViewport({
      panX: rect.width / 2 - (bounds.minX + contentWidth / 2) * zoom,
      panY: rect.height / 2 - (bounds.minY + contentHeight / 2) * zoom,
      zoom
    })
  }, [positionFor, resetViewport, sizeFor, sortedItems, updateViewport])

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const current = viewportRef.current
    if (e.ctrlKey || e.metaKey) {
      applyZoomAt(current.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY)
      return
    }
    updateViewport({
      panX: current.panX - e.deltaX,
      panY: current.panY - e.deltaY,
      zoom: current.zoom
    })
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    if (target.closest('[data-workspace-card], button, input, textarea, a, [role="dialog"]')) return
    e.preventDefault()
    const start = {
      x: e.clientX,
      y: e.clientY,
      panX: viewportRef.current.panX,
      panY: viewportRef.current.panY
    }
    setPanning(true)
    const onMove = (event: MouseEvent) => {
      updateViewport({
        panX: start.panX + event.clientX - start.x,
        panY: start.panY + event.clientY - start.y,
        zoom: viewportRef.current.zoom
      }, false)
    }
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setPanning(false)
      panCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      scheduleViewportSave(viewportRef.current)
    }
    panCleanupRef.current?.()
    panCleanupRef.current = cleanup
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  const hasDocPayload = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes(DOC_MIME)

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasDocPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasDocPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false)
  }

  const parseDocIds = (e: React.DragEvent): string[] => {
    const raw = e.dataTransfer.getData(DOC_MIME)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
      }
    } catch {
      return []
    }
    return []
  }

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasDocPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const ids = parseDocIds(e)
    if (ids.length === 0) return
    const world = worldPositionAt(e.clientX, e.clientY)
    try {
      await addDocs(ids, { x: Math.round(world.x - 150), y: Math.round(world.y - 100) })
    } catch (error) {
      setSummaryErrors((previous) => new Map(previous).set('__drop__', errorMessage(error, t('workspace.addFailed'))))
      if (dropErrorTimerRef.current) clearTimeout(dropErrorTimerRef.current)
      dropErrorTimerRef.current = setTimeout(() => {
        setSummaryErrors((previous) => {
          const next = new Map(previous)
          next.delete('__drop__')
          return next
        })
      }, 3500)
    }
  }

  const handleCreateNote = useCallback(async (
    noteType: WorkspaceNoteType,
    placement?: WorkspaceItemPlacement
  ) => {
    const title = noteType === 'plain'
      ? t('workspace.stickyNoteUntitled')
      : t('workspace.noteUntitled')
    const note = await createNote(title, '', noteType, placement ?? placementAtCanvasCenter())
    if (!note) return
    if (noteType === 'plain') setAutoEditStickyNoteId(note.id)
    else setAutoEditNoteId(note.id)
  }, [createNote, placementAtCanvasCenter, t])

  useImperativeHandle(ref, () => ({
    createNote: (noteType) => {
      void handleCreateNote(noteType)
    }
  }), [handleCreateNote])

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-workspace-card], button, input, textarea, a, [role="dialog"]')) return
    event.preventDefault()
    event.stopPropagation()
    const world = worldPositionAt(event.clientX, event.clientY)
    const placement = { x: Math.round(world.x - 150), y: Math.round(world.y - 100) }
    const items: ContextMenuItem[] = [
      {
        key: 'create-sticky-note',
        label: t('workspace.createStickyNote'),
        icon: <Sticker className="h-3.5 w-3.5" />,
        onClick: () => void handleCreateNote('plain', placement)
      },
      {
        key: 'create-markdown-note',
        label: t('workspace.createNote'),
        icon: <NotePencil className="h-3.5 w-3.5" />,
        onClick: () => void handleCreateNote('markdown', placement)
      }
    ]
    showContextMenu(items)
  }, [handleCreateNote, t, worldPositionAt])

  const cardProps = (item: WorkspaceItem) => ({
    sizeKey: item.id,
    size: sizeFor(item),
    position: positionFor(item),
    scale: viewport.zoom,
    frontZIndex: maxZIndex + 1,
    onSizeChange: handleCardSizeChange,
    onSizeCommit: handleCardSizeCommit,
    onPositionChange: handleCardPositionChange,
    onPositionCommit: handleCardPositionCommit,
    moveLabel: t('workspace.moveCard')
  })

  return (
    <div
      ref={canvasRef}
      className={`board-surface relative h-full w-full min-h-0 min-w-0 select-none overflow-hidden ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{
        backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)',
        backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
        backgroundSize: `${GRID_SIZE * viewport.zoom}px ${GRID_SIZE * viewport.zoom}px`,
        outline: dropActive ? '2px dashed var(--color-accent)' : undefined,
        outlineOffset: dropActive ? '-6px' : undefined
      }}
      onMouseDown={handleCanvasMouseDown}
      onContextMenu={handleCanvasContextMenu}
      onWheel={handleWheel}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      <div className="pointer-events-none absolute left-3 top-3 z-[200000]">
        {summaryErrors.get('__drop__') && (
          <div className="rounded-lg bg-error/10 px-3 py-1.5 text-xs text-error shadow-sm">
            {summaryErrors.get('__drop__')}
          </div>
        )}
      </div>

      {sortedItems.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <EmptyState
            className="h-full min-h-[200px]"
            icon={<FilePlus className="h-10 w-10" />}
            title={t('workspace.dragPapersHint')}
            description={t('workspace.createNoteHint')}
          />
        </div>
      )}

      <div
        className="absolute left-0 top-0 h-px w-px origin-top-left"
        style={{ transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})` }}
      >
        {sortedItems.map((item) => {
          if (item.kind === 'document' && item.docId) {
            const docId = item.docId
            return (
              <ResizableCard key={item.id} {...cardProps(item)}>
                <PaperCard
                  doc={docs.get(docId) ?? null}
                  summary={summaries.get(docId) ?? null}
                  summarizing={summarizing.has(docId)}
                  summaryError={summaryErrors.get(docId) ?? null}
                  onSummarize={() => handleSummarize(docId)}
                  onOpenPdf={() => void api.documents.openPdf(docId)}
                  onRemove={() => void removeItem(item.id)}
                />
              </ResizableCard>
            )
          }
          if (item.kind === 'report' && item.reportId) {
            const report = reportMap.get(item.reportId)
            if (!report) return null
            return (
              <ResizableCard key={item.id} {...cardProps(item)}>
                <ReportCard
                  report={report}
                  sourceDocuments={docs}
                  onOpenSource={(docId) => void api.documents.openPdf(docId)}
                  onDelete={() => void deleteReport(report.id)}
                  onUpdate={updateReport}
                />
              </ResizableCard>
            )
          }
          if (item.kind === 'note' && item.noteId) {
            const note = noteMap.get(item.noteId)
            if (!note) return null
            if (note.noteType === 'plain') {
              return (
                <ResizableCard key={item.id} {...cardProps(item)}>
                  <StickyNoteCard
                    note={note}
                    autoFocus={autoEditStickyNoteId === note.id}
                    onAutoFocusHandled={() => setAutoEditStickyNoteId(null)}
                    onDelete={() => void deleteNote(note.id)}
                    onUpdate={updateNote}
                  />
                </ResizableCard>
              )
            }
            return (
              <ResizableCard key={item.id} {...cardProps(item)}>
                <NoteCard
                  note={note}
                  autoEdit={autoEditNoteId === note.id}
                  onAutoEditHandled={() => setAutoEditNoteId(null)}
                  onDelete={() => void deleteNote(note.id)}
                  onUpdate={updateNote}
                />
              </ResizableCard>
            )
          }
          return null
        })}
      </div>

      <div className="absolute bottom-3 left-3 z-[200000] rounded-lg border border-border bg-panel/90 px-2.5 py-1.5 text-[11px] text-muted shadow-sm backdrop-blur">
        {t('workspace.canvasHint')}
      </div>
      <div className="absolute bottom-3 right-3 z-[200000] flex items-center gap-1 rounded-xl border border-border bg-panel/90 p-1 shadow-md backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('workspace.canvasZoomOut')}
          title={t('workspace.canvasZoomOut')}
          onClick={() => applyZoomAt(viewportRef.current.zoom / 1.2)}
        >
          −
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="min-w-[52px]"
          aria-label={t('workspace.canvasReset')}
          title={t('workspace.canvasReset')}
          onClick={resetViewport}
        >
          {Math.round(viewport.zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('workspace.canvasZoomIn')}
          title={t('workspace.canvasZoomIn')}
          onClick={() => applyZoomAt(viewportRef.current.zoom * 1.2)}
        >
          +
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={fitAll}>
          {t('workspace.canvasFit')}
        </Button>
      </div>
    </div>
  )
})

export default Board
