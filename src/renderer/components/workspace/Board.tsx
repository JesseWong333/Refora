import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { api } from '../../ipc'
import type { AiSummary, Document, SummaryErrorEvent } from '../../../shared/ipc-types'
import PaperCard from './PaperCard'
import ReportCard from './ReportCard'
import ResizableCard, {
  clampCardSize,
  defaultCardSize,
  type CardSize
} from './ResizableCard'

const DOC_MIME = 'application/x-refora-docids'

export default function Board() {
  const { t } = useTranslation()
  const items = useWorkspaceStore((s) => s.items)
  const reports = useWorkspaceStore((s) => s.reports)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const addDocs = useWorkspaceStore((s) => s.addDocs)
  const removeItem = useWorkspaceStore((s) => s.removeItem)
  const fetchItems = useWorkspaceStore((s) => s.fetchItems)
  const deleteReport = useWorkspaceStore((s) => s.deleteReport)

  const [docs, setDocs] = useState<Map<string, Document>>(new Map())
  const [summaries, setSummaries] = useState<Map<string, AiSummary>>(new Map())
  const [summarizing, setSummarizing] = useState<Set<string>>(new Set())
  const [summaryErrors, setSummaryErrors] = useState<Map<string, string>>(new Map())
  const [dropActive, setDropActive] = useState(false)
  const [cardSizes, setCardSizes] = useState<Record<string, CardSize>>({})

  const docItems = items.filter((it) => it.kind === 'document' && it.docId)
  const docIds = docItems.map((it) => it.docId as string)
  const docIdsKey = docIds.join('|')

  useEffect(() => {
    setDocs(new Map())
    setSummaries(new Map())
    setSummarizing(new Set())
    setSummaryErrors(new Map())
    setCardSizes({})
  }, [activeWorkspaceId])

  const handleCardSizeChange = useCallback((sizeKey: string, size: CardSize) => {
    setCardSizes((prev) => ({ ...prev, [sizeKey]: clampCardSize(size) }))
  }, [])

  const sizeFor = (key: string): CardSize => cardSizes[key] ?? defaultCardSize()

  useEffect(() => {
    let cancelled = false
    const ids = docIds
    void Promise.all(
      ids.map(async (docId) => {
        try {
          const [doc, summary] = await Promise.all([
            api.documents.get(docId),
            api.ai.summaryGet(docId)
          ])
          if (cancelled) return
          setDocs((prev) => {
            if (!doc) return prev
            const next = new Map(prev)
            next.set(docId, doc)
            return next
          })
          setSummaries((prev) => {
            if (!summary) return prev
            const next = new Map(prev)
            next.set(docId, summary)
            return next
          })
        } catch {
          void 0
        }
      })
    )
    return () => {
      cancelled = true
    }
  }, [docIdsKey])

  useEffect(() => {
    const cb = (docId: string) => {
      void api.ai.summaryGet(docId).then((summary) => {
        setSummaries((prev) => {
          const next = new Map(prev)
          if (summary) next.set(docId, summary)
          else next.delete(docId)
          return next
        })
        setSummarizing((prev) => {
          if (!prev.has(docId)) return prev
          const next = new Set(prev)
          next.delete(docId)
          return next
        })
      })
    }
    const errCb = (payload: SummaryErrorEvent) => {
      setSummarizing((prev) => {
        if (!prev.has(payload.docId)) return prev
        const next = new Set(prev)
        next.delete(payload.docId)
        return next
      })
      setSummaryErrors((prev) => {
        const next = new Map(prev)
        next.set(payload.docId, payload.message)
        return next
      })
    }
    api.events.onAiSummaryUpdated(cb)
    api.events.onAiSummaryError(errCb)
    return () => {
      api.events.off('ai:summary:updated', cb)
      api.events.off('ai:summary:error', errCb)
    }
  }, [])

  const handleSummarize = (docId: string) => {
    setSummaryErrors((prev) => {
      if (!prev.has(docId)) return prev
      const next = new Map(prev)
      next.delete(docId)
      return next
    })
    setSummarizing((prev) => {
      const next = new Set(prev)
      next.add(docId)
      return next
    })
    api.ai.summarize(docId).catch(() => {
      setSummarizing((prev) => {
        const next = new Set(prev)
        next.delete(docId)
        return next
      })
    })
  }

  const hasDocPayload = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types)
    return types.includes(DOC_MIME) || types.includes('text/plain')
  }

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
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropActive(false)
    }
  }

  const parseDocIds = (e: React.DragEvent): string[] => {
    const raw = e.dataTransfer.getData(DOC_MIME) || e.dataTransfer.getData('text/plain')
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
      }
    } catch {
      void 0
    }
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const ids = parseDocIds(e)
    if (ids.length === 0) return
    try {
      await addDocs(ids)
      await fetchItems()
    } catch {
      void 0
    }
  }

  const sortedDocItems = [...docItems].sort((a, b) => a.sortOrder - b.sortOrder)
  const sortedReports = [...reports].sort((a, b) => b.createdAt - a.createdAt)
  const isEmpty = sortedDocItems.length === 0 && sortedReports.length === 0

  return (
    <div
      className="board-surface h-full w-full min-h-0 min-w-0 overflow-auto p-4"
      style={
        dropActive
          ? { outline: '2px dashed var(--color-accent)', outlineOffset: '-6px' }
          : undefined
      }
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {isEmpty ? (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted">{t('workspace.dragPapersHint')}</p>
        </div>
      ) : (
        <div className="flex flex-wrap content-start gap-3">
          {sortedDocItems.map((it) => {
            const docId = it.docId as string
            const key = `doc:${it.id}`
            return (
              <ResizableCard
                key={it.id}
                sizeKey={key}
                size={sizeFor(key)}
                onSizeChange={handleCardSizeChange}
              >
                <PaperCard
                  doc={docs.get(docId) ?? null}
                  summary={summaries.get(docId) ?? null}
                  summarizing={summarizing.has(docId)}
                  summaryError={summaryErrors.get(docId) ?? null}
                  onSummarize={() => handleSummarize(docId)}
                  onOpenPdf={() => void api.documents.openPdf(docId)}
                  onRemove={() => void removeItem(it.id)}
                />
              </ResizableCard>
            )
          })}
          {sortedReports.map((r) => {
            const key = `report:${r.id}`
            return (
              <ResizableCard
                key={r.id}
                sizeKey={key}
                size={sizeFor(key)}
                onSizeChange={handleCardSizeChange}
              >
                <ReportCard report={r} onDelete={() => void deleteReport(r.id)} />
              </ResizableCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
