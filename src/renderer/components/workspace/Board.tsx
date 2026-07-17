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
  WorkspaceConnection,
  WorkspaceConnectionAnchor,
  WorkspaceItem,
  WorkspaceItemPlacement,
  WorkspaceNote,
  WorkspaceNoteType
} from '../../../shared/ipc-types'
import PaperCard from './PaperCard'
import ReportCard from './ReportCard'
import NoteCard from './NoteCard'
import StickyNoteCard from './StickyNoteCard'
import AssetCard from './AssetCard'
import ResizableCard, {
  clampCardSize,
  type CardPosition,
  type CardSize
} from './ResizableCard'
import {
  cardAnchorPoint,
  closestCardAnchor,
  connectionCurve,
  targetAnchorForPreview,
  type ConnectionPoint
} from './connectionGeometry'

const DOC_MIME = 'application/x-refora-docids'
const GRID_SIZE = 32
const VIEWPORT_SAVE_DELAY = 160
const EMPTY_NOTES: WorkspaceNote[] = []
const DEFAULT_VIEWPORT: WorkspaceCanvasViewport = {
  panX: 0,
  panY: 0,
  zoom: WORKSPACE_CANVAS_DEFAULT_ZOOM
}

interface ConnectionDraft {
  sourceItemId: string
  sourceAnchor: WorkspaceConnectionAnchor
  source: ConnectionPoint
  pointer: ConnectionPoint
}

function clampZoom(zoom: number): number {
  return Math.max(WORKSPACE_CANVAS_MIN_ZOOM, Math.min(WORKSPACE_CANVAS_MAX_ZOOM, zoom))
}

export interface BoardHandle {
  createNote: (noteType: WorkspaceNoteType) => void
  addFiles: () => void
}

const Board = forwardRef<BoardHandle>(function Board(_, ref) {
  const { t } = useTranslation()
  const items = useWorkspaceStore((s) => s.items)
  const reports = useWorkspaceStore((s) => s.reports)
  const notes = useWorkspaceStore((s) => s.notes) ?? EMPTY_NOTES
  const assets = useWorkspaceStore((s) => s.assets) ?? []
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const addDocs = useWorkspaceStore((s) => s.addDocs)
  const addAssets = useWorkspaceStore((s) => s.addAssets)
  const deleteAsset = useWorkspaceStore((s) => s.deleteAsset)
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
  const [connections, setConnections] = useState<WorkspaceConnection[]>([])
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null)
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const activeWorkspaceIdRef = useRef(activeWorkspaceId)
  const viewportRef = useRef<WorkspaceCanvasViewport>(DEFAULT_VIEWPORT)
  const viewportTouchedRef = useRef(false)
  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panCleanupRef = useRef<(() => void) | null>(null)
  const connectionCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.zIndex - b.zIndex || a.addedAt - b.addedAt),
    [items]
  )
  const reportMap = useMemo(() => new Map(reports.map((report) => [report.id, report])), [reports])
  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes])
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])
  const itemMap = useMemo(() => new Map(sortedItems.map((item) => [item.id, item])), [sortedItems])
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
    setConnections([])
    setConnectionDraft(null)
    setSelectedConnectionId(null)
  }, [activeWorkspaceId])

  useEffect(() => {
    connectionCleanupRef.current?.()
    if (!activeWorkspaceId) return
    const workspaceId = activeWorkspaceId
    let cancelled = false
    void api.workspaceConnections.list(workspaceId).then((saved) => {
      if (!cancelled && activeWorkspaceIdRef.current === workspaceId) {
        setConnections(saved)
      }
    }).catch((e) => {
      if (!cancelled) {
        useDocumentStore.getState().showToast(errorMessage(e, t('workspace.connectionLoadFailed')))
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, t])

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
      connectionCleanupRef.current?.()
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

  const boundsFor = useCallback((item: WorkspaceItem) => {
    const position = positionFor(item)
    const size = sizeFor(item)
    return { x: position.x, y: position.y, width: size.width, height: size.height }
  }, [positionFor, sizeFor])

  const connectionPaths = useMemo(() => connections.flatMap((connection) => {
    const sourceItem = itemMap.get(connection.sourceItemId)
    const targetItem = itemMap.get(connection.targetItemId)
    if (!sourceItem || !targetItem) return []
    const source = cardAnchorPoint(boundsFor(sourceItem), connection.sourceAnchor)
    const target = cardAnchorPoint(boundsFor(targetItem), connection.targetAnchor)
    return [{ connection, ...connectionCurve(source, target, connection.sourceAnchor, connection.targetAnchor) }]
  }), [boundsFor, connections, itemMap])

  const worldPositionAt = useCallback((clientX: number, clientY: number): WorkspaceItemPlacement => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const current = viewportRef.current
    return {
      x: (clientX - rect.left - current.panX) / current.zoom,
      y: (clientY - rect.top - current.panY) / current.zoom
    }
  }, [])

  const handleDeleteConnection = useCallback(async (connectionId: string) => {
    try {
      await api.workspaceConnections.delete(connectionId)
      setConnections((previous) => previous.filter((connection) => connection.id !== connectionId))
      setSelectedConnectionId((current) => current === connectionId ? null : current)
    } catch (e) {
      useDocumentStore.getState().showToast(errorMessage(e, t('workspace.connectionDeleteFailed')))
    }
  }, [t])

  const handleConnectionStart = useCallback((
    sourceItemId: string,
    sourceAnchor: WorkspaceConnectionAnchor,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (!activeWorkspaceId || event.button !== 0) return
    const sourceItem = itemMap.get(sourceItemId)
    if (!sourceItem) return
    event.preventDefault()
    event.stopPropagation()
    connectionCleanupRef.current?.()
    const workspaceId = activeWorkspaceId
    const source = cardAnchorPoint(boundsFor(sourceItem), sourceAnchor)
    setSelectedConnectionId(null)
    setConnectionDraft({ sourceItemId, sourceAnchor, source, pointer: source })

    const cleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setConnectionDraft(null)
      if (connectionCleanupRef.current === cleanup) connectionCleanupRef.current = null
    }

    const onMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault()
      const pointer = worldPositionAt(moveEvent.clientX, moveEvent.clientY)
      setConnectionDraft((current) => current ? { ...current, pointer } : current)
    }

    const onUp = (upEvent: MouseEvent) => {
      const pointer = worldPositionAt(upEvent.clientX, upEvent.clientY)
      const elements = document.elementsFromPoint?.(upEvent.clientX, upEvent.clientY) ?? []
      const targetElement = elements
        .map((element) => element.closest<HTMLElement>('[data-workspace-card-id]'))
        .find((element): element is HTMLElement => Boolean(element))
      const targetItemId = targetElement?.dataset.workspaceCardId
      const targetItem = targetItemId ? itemMap.get(targetItemId) : undefined
      cleanup()
      if (!targetItemId || !targetItem || targetItemId === sourceItemId) return
      const targetAnchor = closestCardAnchor(pointer, boundsFor(targetItem))
      void api.workspaceConnections.create(
        workspaceId,
        sourceItemId,
        targetItemId,
        sourceAnchor,
        targetAnchor
      ).then((saved) => {
        if (activeWorkspaceIdRef.current !== workspaceId) return
        setConnections((previous) => {
          const withoutSaved = previous.filter((connection) => connection.id !== saved.id)
          return [...withoutSaved, saved]
        })
      }).catch((e) => {
        if (activeWorkspaceIdRef.current === workspaceId) {
          useDocumentStore.getState().showToast(errorMessage(e, t('workspace.connectionSaveFailed')))
        }
      })
    }

    connectionCleanupRef.current = cleanup
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'none'
  }, [activeWorkspaceId, boundsFor, itemMap, t, worldPositionAt])

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

  const hasFilePayload = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes('Files')

  const hasSupportedPayload = (e: React.DragEvent) => hasDocPayload(e) || hasFilePayload(e)

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasSupportedPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropActive(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasSupportedPayload(e)) return
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
    if (!hasSupportedPayload(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const world = worldPositionAt(e.clientX, e.clientY)
    const placement = { x: Math.round(world.x - 150), y: Math.round(world.y - 100) }
    try {
      if (hasDocPayload(e)) {
        const ids = parseDocIds(e)
        if (ids.length === 0) return
        await addDocs(ids, placement)
      } else {
        const paths = Array.from(e.dataTransfer.files)
          .map((file) => api.getPathForFile(file))
          .filter((path) => path.length > 0)
        if (paths.length === 0) return
        await addAssets(paths, placement)
      }
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

  const handleOpenAsset = useCallback((assetId: string) => {
    void api.workspaceAssets.open(assetId).catch((error) => {
      useDocumentStore.getState().showToast(errorMessage(error, t('workspace.assetOpenFailed')))
    })
  }, [t])

  const handleRevealAsset = useCallback((assetId: string) => {
    void api.workspaceAssets.reveal(assetId).catch((error) => {
      useDocumentStore.getState().showToast(errorMessage(error, t('workspace.assetRevealFailed')))
    })
  }, [t])

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
    },
    addFiles: () => {
      void addAssets([], placementAtCanvasCenter())
    }
  }), [addAssets, handleCreateNote, placementAtCanvasCenter])

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('[data-workspace-card], button, input, textarea, a, [role="dialog"]')) return
    event.preventDefault()
    event.stopPropagation()
    const world = worldPositionAt(event.clientX, event.clientY)
    const placement = { x: Math.round(world.x - 150), y: Math.round(world.y - 100) }
    const items: ContextMenuItem[] = [
      {
        key: 'add-files',
        label: t('workspace.assetAdd'),
        icon: <FilePlus className="h-3.5 w-3.5" />,
        onClick: () => void addAssets([], placement)
      },
      { type: 'divider', key: 'file-divider' },
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
  }, [addAssets, handleCreateNote, t, worldPositionAt])

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
    onConnectionStart: handleConnectionStart,
    connectionLabel: t('workspace.connectionStart'),
    moveLabel: t('workspace.moveCard')
  })

  return (
    <div
      ref={canvasRef}
      className={`board-surface relative h-full w-full min-h-0 min-w-0 select-none overflow-hidden ${connectionDraft ? 'is-connecting' : ''} ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
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
        <svg className="pointer-events-none absolute left-0 top-0 h-px w-px overflow-visible" aria-hidden="false">
          <defs>
            <marker id="workspace-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 9 4.5 L 0 9 z" fill="var(--color-muted)" />
            </marker>
            <marker id="workspace-arrow-selected" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 9 4.5 L 0 9 z" fill="var(--color-accent)" />
            </marker>
          </defs>
          {connectionPaths.map(({ connection, path }) => {
            const selected = selectedConnectionId === connection.id
            return (
              <g key={connection.id}>
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                  style={{ pointerEvents: 'stroke' }}
                  role="button"
                  tabIndex={0}
                  aria-label={t('workspace.connectionSelect')}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedConnectionId(connection.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    void handleDeleteConnection(connection.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                      event.preventDefault()
                      void handleDeleteConnection(connection.id)
                    }
                  }}
                />
                <path
                  d={path}
                  fill="none"
                  stroke={selected ? 'var(--color-accent)' : 'var(--color-muted)'}
                  strokeOpacity={selected ? 0.9 : 0.55}
                  strokeWidth={selected ? 2.5 : 2}
                  markerEnd={selected ? 'url(#workspace-arrow-selected)' : 'url(#workspace-arrow)'}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            )
          })}
          {connectionDraft && (() => {
            const targetAnchor = targetAnchorForPreview(connectionDraft.source, connectionDraft.pointer)
            const preview = connectionCurve(
              connectionDraft.source,
              connectionDraft.pointer,
              connectionDraft.sourceAnchor,
              targetAnchor
            )
            return (
              <path
                d={preview.path}
                fill="none"
                stroke="var(--color-muted)"
                strokeOpacity="0.65"
                strokeWidth="2"
                strokeDasharray="7 6"
                markerEnd="url(#workspace-arrow)"
              />
            )
          })()}
        </svg>
        {sortedItems.map((item) => {
          if (item.kind === 'document' && item.docId) {
            const docId = item.docId
            return (
              <ResizableCard
                key={item.id}
                {...cardProps(item)}
                className="workspace-connection-accent--document"
              >
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
              <ResizableCard
                key={item.id}
                {...cardProps(item)}
                className="workspace-connection-accent--report"
              >
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
                <ResizableCard
                  key={item.id}
                  {...cardProps(item)}
                  className="workspace-connection-accent--sticky"
                >
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
              <ResizableCard
                key={item.id}
                {...cardProps(item)}
                className="workspace-connection-accent--note"
              >
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
          if (item.kind === 'asset' && item.assetId) {
            const asset = assetMap.get(item.assetId)
            if (!asset) return null
            return (
              <ResizableCard
                key={item.id}
                {...cardProps(item)}
                className="workspace-connection-accent--asset"
              >
                <AssetCard
                  asset={asset}
                  onOpen={() => handleOpenAsset(asset.id)}
                  onReveal={() => handleRevealAsset(asset.id)}
                  onDelete={() => void deleteAsset(asset.id)}
                />
              </ResizableCard>
            )
          }
          return null
        })}
        {selectedConnectionId && connectionPaths.map(({ connection, midpoint }) => (
          connection.id === selectedConnectionId && (
            <button
              key={connection.id}
              type="button"
              className="absolute z-[200003] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-sm leading-none text-muted shadow-md hover:border-error hover:text-error"
              style={{ left: midpoint.x, top: midpoint.y }}
              aria-label={t('workspace.connectionDelete')}
              title={t('workspace.connectionDelete')}
              onClick={() => void handleDeleteConnection(connection.id)}
            >
              ×
            </button>
          )
        ))}
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
        <span className="min-w-[44px] text-center text-xs tabular-nums text-muted">
          {Math.round(viewport.zoom * 100)}%
        </span>
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
        <Button
          variant="ghost"
          size="sm"
          className="min-w-[52px]"
          aria-label={t('workspace.canvasReset')}
          title={t('workspace.canvasReset')}
          onClick={() => applyZoomAt(WORKSPACE_CANVAS_DEFAULT_ZOOM)}
        >
          Reset
        </Button>
        <Button variant="ghost" size="sm" onClick={fitAll}>
          {t('workspace.canvasFit')}
        </Button>
      </div>
    </div>
  )
})

export default Board
