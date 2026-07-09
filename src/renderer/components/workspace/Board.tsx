import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { api } from '../../ipc'
import type { AiSummary, Document } from '../../../shared/ipc-types'
import PaperCard from './PaperCard'
import ReportCard from './ReportCard'

const DOC_MIME = 'application/x-refora-docids'

export default function Board() {
  const { t } = useTranslation()
  const items = useWorkspaceStore((s) => s.items)
  const reports = useWorkspaceStore((s) => s.reports)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const addDocs = useWorkspaceStore((s) => s.addDocs)
  const removeItem = useWorkspaceStore((s) => s.removeItem)
  const fetchItems = useWorkspaceStore((s) => s.fetchItems)

  const [docs, setDocs] = useState<Map<string, Document>>(new Map())
  const [summaries, setSummaries] = useState<Map<string, AiSummary>>(new Map())
  const [summarizing, setSummarizing] = useState<Set<string>>(new Set())
  const [dropActive, setDropActive] = useState(false)

  const docItems = items.filter((it) => it.kind === 'document' && it.docId)
  const docIds = docItems.map((it) => it.docId as string)
  const docIdsKey = docIds.join('|')

  useEffect(() => {
    setDocs(new Map())
    setSummaries(new Map())
    setSummarizing(new Set())
  }, [activeWorkspaceId])

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
    api.events.onAiSummaryUpdated(cb)
    return () => {
      api.events.off('ai:summary:updated', cb)
    }
  }, [])

  const handleSummarize = (docId: string) => {
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

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DOC_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropActive(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DOC_MIME)
    setDropActive(false)
    if (!raw) return
    e.preventDefault()
    try {
      const ids: string[] = JSON.parse(raw)
      if (ids.length > 0) {
        await addDocs(ids)
        await fetchItems()
      }
    } catch {
      void 0
    }
  }

  const sortedDocItems = [...docItems].sort((a, b) => a.sortOrder - b.sortOrder)
  const sortedReports = [...reports].sort((a, b) => b.createdAt - a.createdAt)
  const isEmpty = sortedDocItems.length === 0 && sortedReports.length === 0

  return (
    <div
      className="h-full w-full overflow-auto p-4"
      style={dropActive ? { outline: '2px dashed var(--color-accent)', outlineOffset: '-6px' } : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      {isEmpty ? (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted">{t('workspace.dragPapersHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {sortedDocItems.map((it) => {
            const docId = it.docId as string
            return (
              <PaperCard
                key={it.id}
                doc={docs.get(docId) ?? null}
                summary={summaries.get(docId) ?? null}
                summarizing={summarizing.has(docId)}
                onSummarize={() => handleSummarize(docId)}
                onOpenPdf={() => void api.documents.openPdf(docId)}
                onRemove={() => void removeItem(it.id)}
              />
            )
          })}
          {sortedReports.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  )
}
