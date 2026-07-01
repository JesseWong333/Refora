import { useTranslation } from 'react-i18next'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocumentStore } from '../store/documentStore'
import { api } from '../ipc'
import type {
  Document,
  EditableField,
  RemoteValue,
  Category,
  DocumentPatch
} from '../../shared/ipc-types'

const EDITABLE_FIELDS: { field: EditableField; labelKey: string }[] = [
  { field: 'title', labelKey: 'detail.title' },
  { field: 'authors', labelKey: 'detail.authors' },
  { field: 'year', labelKey: 'detail.year' },
  { field: 'venue', labelKey: 'detail.venue' },
  { field: 'volume', labelKey: 'detail.volume' },
  { field: 'abstract', labelKey: 'detail.abstract' },
  { field: 'keywords', labelKey: 'detail.keywords' },
  { field: 'url', labelKey: 'detail.url' },
  { field: 'doi', labelKey: 'DOI' },
  { field: 'note', labelKey: 'detail.note' }
]

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

function InlineField({
  field,
  label,
  value,
  remoteValue,
  docId,
  onSaved
}: {
  field: EditableField
  label: string
  value: string
  remoteValue?: RemoteValue
  docId: string
  onSaved: (doc: Document) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const statusRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setText(value)
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const save = useCallback(async () => {
    const trimmed = text.trim()
    const current = (value ?? '')
    if (trimmed === current) {
      setEditing(false)
      return
    }
    setStatus('saving')
    try {
      const patch: DocumentPatch = {}
      patch[field] = trimmed || ''
      const doc = await api.documents.update(docId, patch)
      onSaved(doc)
      setStatus('saved')
      if (statusRef.current) clearTimeout(statusRef.current)
      statusRef.current = setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setText(value)
      setStatus('idle')
    }
    setEditing(false)
  }, [text, value, field, docId, onSaved])

  const applyRemote = useCallback(async () => {
    if (!remoteValue) return
    setText(remoteValue.value)
    setStatus('saving')
    try {
      const patch: DocumentPatch = {}
      patch[field] = remoteValue.value
      const doc = await api.documents.update(docId, patch)
      onSaved(doc)
      setStatus('saved')
      if (statusRef.current) clearTimeout(statusRef.current)
      statusRef.current = setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setText(value)
      setStatus('idle')
    }
  }, [field, remoteValue, docId, onSaved, value])

  const hasRemoteDiff = remoteValue && remoteValue.value !== '' && remoteValue.value !== (value ?? '')

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
        {status === 'saving' && (
          <span className="text-[10px] font-normal normal-case text-muted">
            {t('common.saving')}
          </span>
        )}
        {status === 'saved' && (
          <span className="text-[10px] font-normal normal-case text-accent">
            {t('common.saved')}
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        {editing ? (
          <input
            ref={inputRef}
            className="field-input flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') {
                e.stopPropagation()
                setText(value)
                setEditing(false)
              }
            }}
          />
        ) : (
          <div
            className="field-input cursor-text text-sm"
            onClick={() => setEditing(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') setEditing(true)
            }}
          >
            {value || '\u2014'}
          </div>
        )}
        {hasRemoteDiff && !editing && (
          <button
            className="flex-shrink-0 text-xs text-accent hover:text-accent-hover"
            title={t('detail.applyRemote') ?? 'Apply remote value'}
            onClick={applyRemote}
          >
            {'\u21BB'}
          </button>
        )}
      </div>
    </div>
  )
}

function NoteField({
  value,
  docId,
  onSaved
}: {
  value: string
  docId: string
  onSaved: (doc: Document) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState(value ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveRef = useRef<ReturnType<typeof setTimeout>>()
  const statusRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setText(value ?? '')
  }, [value])

  const save = useCallback(async () => {
    const current = value ?? ''
    if (text === current) return
    setStatus('saving')
    try {
      const doc = await api.documents.update(docId, { note: text })
      onSaved(doc)
      setStatus('saved')
      if (statusRef.current) clearTimeout(statusRef.current)
      statusRef.current = setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setText(value ?? '')
      setStatus('idle')
    }
  }, [text, value, docId, onSaved])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    if (saveRef.current) clearTimeout(saveRef.current)
    saveRef.current = setTimeout(save, 1000)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t('detail.note')}
        {status === 'saving' && (
          <span className="text-[10px] font-normal normal-case text-muted">
            {t('common.saving')}
          </span>
        )}
        {status === 'saved' && (
          <span className="text-[10px] font-normal normal-case text-accent">
            {t('common.saved')}
          </span>
        )}
      </span>
      <textarea
        className="field-input min-h-[96px] resize-y text-sm"
        value={text}
        onChange={handleChange}
        onBlur={() => {
          if (saveRef.current) clearTimeout(saveRef.current)
          save()
        }}
      />
    </div>
  )
}

function CategoryChips({
  docId,
  docCategories
}: {
  docId: string
  docCategories?: Category[]
}) {
  const { t } = useTranslation()
  const allCategories = useDocumentStore((s) => s.categories)
  const fetchCategories = useDocumentStore((s) => s.fetchCategories)
  const [assigned, setAssigned] = useState<Category[]>(docCategories ?? [])
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    setAssigned(docCategories ?? [])
  }, [docId, docCategories])

  const assignedIds = new Set(assigned.map((c) => c.id))
  const unassigned = allCategories.filter((c) => !assignedIds.has(c.id))

  const unassign = async (catId: string) => {
    const removed = assigned.find((c) => c.id === catId)
    setAssigned((prev) => prev.filter((c) => c.id !== catId))
    try {
      await api.categories.unassign(docId, catId)
      void fetchCategories()
    } catch {
      if (removed) setAssigned((prev) => { const s = [...prev, removed]; return s })
      fetchCategories().catch(() => {})
    }
  }

  const assign = async (catId: string) => {
    const cat = allCategories.find((c) => c.id === catId)
    if (cat) setAssigned((prev) => [...prev, { ...cat, count: undefined }])
    setShowPicker(false)
    try {
      await api.categories.assign(docId, catId)
      void fetchCategories()
    } catch {
      setAssigned((prev) => prev.filter((c) => c.id !== catId))
      fetchCategories().catch(() => {})
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {t('sidebar.categories')}
      </span>
      <div className="flex flex-wrap items-center gap-1">
        {assigned.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-0.5 rounded bg-panel-2 px-1.5 py-0.5 text-xs text-foreground"
          >
            {c.name}
            <button
              className="ml-0.5 text-muted hover:text-error"
              onClick={() => unassign(c.id)}
              title={t('common.delete') ?? 'Remove'}
            >
              {'\u00D7'}
            </button>
          </span>
        ))}
        {showPicker ? (
          <select
            className="rounded border border-border bg-panel px-1 py-0.5 text-xs text-foreground"
            value=""
            onChange={(e) => {
              if (e.target.value) assign(e.target.value)
            }}
            autoFocus
            onBlur={() => setShowPicker(false)}
          >
            <option value="">+</option>
            {unassigned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {unassigned.length === 0 && (
              <option disabled>{'\u2014'}</option>
            )}
          </select>
        ) : (
          <button
            className="text-xs text-accent hover:text-accent-hover"
            onClick={() => setShowPicker(true)}
          >
            +
          </button>
        )}
      </div>
    </div>
  )
}

function SingleDetail({ doc }: { doc: Document }) {
  const { t } = useTranslation()
  const updateDocument = useDocumentStore((s) => s.updateDocument)
  const openInFinder = useDocumentStore((s) => s.openInFinder)
  const refreshMetadata = useDocumentStore((s) => s.refreshMetadata)
  const requestDeleteConfirm = useDocumentStore((s) => s.requestDeleteConfirm)
  const [refreshing, setRefreshing] = useState(false)

  const onSaved = useCallback(
    (d: Document) => updateDocument(d.id, {}).then(() => {}),
    [updateDocument]
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await refreshMetadata(doc.id)
    setRefreshing(false)
  }

  const handleRelocate = async () => {
    try {
      await api.documents.relocateFile(doc.id, '')
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
      useDocumentStore.getState().showToast(msg)
    }
  }

  const handleRestore = async () => {
    try {
      const updated = await api.documents.restoreFile(doc.id)
      updateDocument(doc.id, {}).then(() => {})
      useDocumentStore.getState().patchDocument(doc.id, updated)
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : ''
      useDocumentStore.getState().showToast(msg)
    }
  }

  const remoteValues: Record<string, RemoteValue> = doc.remoteValues ?? {}
  const isMoved =
    doc.originalFolderPath && doc.filePath &&
    !doc.filePath.startsWith(doc.originalFolderPath)

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex items-center justify-between">
        <button
          className="text-[11px] text-accent hover:text-accent-hover"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? '\u23F3' : t('detail.refreshMetadata')}
        </button>
      </div>

      {EDITABLE_FIELDS.filter((f) => f.field !== 'note').map(({ field, labelKey }) => (
        <InlineField
          key={field}
          field={field}
          label={labelKey === 'DOI' ? 'DOI' : t(`detail.${field}` as never)}
          value={(doc[field] as string) ?? ''}
          remoteValue={remoteValues[field]}
          docId={doc.id}
          onSaved={onSaved}
        />
      ))}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t('detail.addedAt')}
        </span>
        <div className="text-sm text-muted">{formatDate(doc.addedAt)}</div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {t('detail.filePath')}
        </span>
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-muted">
            {formatFilePath(doc.filePath)}
          </span>
          {!doc.fileMissing && (
            <button
              className="text-xs text-accent hover:text-accent-hover flex-shrink-0"
              onClick={() => openInFinder(doc.id)}
            >
              {t('common.openInFinder')}
            </button>
          )}
          {doc.fileMissing && (
            <button
              className="text-xs text-warning hover:underline flex-shrink-0"
              onClick={handleRelocate}
            >
              {t('detail.relocate')}
            </button>
          )}
        </div>
      </div>

      {isMoved && (
        <div className="flex flex-col gap-1">
          <button
            className="text-xs text-accent hover:text-accent-hover self-start"
            onClick={handleRestore}
          >
            {t('detail.restoreOriginal')}
          </button>
        </div>
      )}

      <NoteField value={doc.note ?? ''} docId={doc.id} onSaved={onSaved} />

      <CategoryChips docId={doc.id} docCategories={doc.categories} />

      <button
        className="self-start text-xs text-error hover:underline"
        onClick={() => requestDeleteConfirm([doc.id], t('dialog.deleteConfirm'))}
      >
        {t('common.delete')}
      </button>
    </div>
  )
}

function BulkBar({
  count,
  selectedIds
}: {
  count: number
  selectedIds: string[]
}) {
  const { t } = useTranslation()
  const requestDeleteConfirm = useDocumentStore((s) => s.requestDeleteConfirm)
  const bulkRefreshMetadata = useDocumentStore((s) => s.bulkRefreshMetadata)
  const bulkCategorize = useDocumentStore((s) => s.bulkCategorize)
  const allCategories = useDocumentStore((s) => s.categories)
  const fetchCategories = useDocumentStore((s) => s.fetchCategories)

  useEffect(() => {
    void fetchCategories()
  }, [])

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="text-sm font-semibold text-foreground">
        {t('common.multiSelected', { count })}
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="toolbar-btn justify-start text-error"
          onClick={() => requestDeleteConfirm(selectedIds, t('dialog.deleteConfirm'))}
        >
          {t('common.delete')} ({count})
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{t('sidebar.categories')}</span>
          <select
            className="rounded border border-border bg-panel px-2 py-1 text-xs text-foreground"
            value=""
            onChange={(e) => {
              if (e.target.value) bulkCategorize(selectedIds, e.target.value)
            }}
          >
            <option value="">{t('common.create')}…</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="toolbar-btn justify-start"
          onClick={() => bulkRefreshMetadata(selectedIds)}
        >
          {t('detail.refreshMetadata')} ({count})
        </button>
        <button
          className="toolbar-btn justify-start"
          onClick={() => void api.export.toBibtex(selectedIds)}
        >
          {t('common.exportBibtexTitle')} ({count})
        </button>
      </div>
    </div>
  )
}

export default function DetailPanel() {
  const { t } = useTranslation()
  const documents = useDocumentStore((s) => s.documents)
  const selectedIds = useDocumentStore((s) => s.selectedIds)
  const focusedDocId = useDocumentStore((s) => s.focusedDocId)
  const toastMessage = useDocumentStore((s) => s.toastMessage)

  const focusedDoc = documents.find((d) => d.id === focusedDocId) ?? null

  if (selectedIds.length >= 2) {
    return (
      <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel">
        <BulkBar count={selectedIds.length} selectedIds={selectedIds} />
        {toastMessage && (
          <div className="fixed bottom-4 right-4 z-50 rounded border border-border bg-panel px-3 py-2 text-xs text-foreground shadow-lg">
            {toastMessage}
          </div>
        )}
      </div>
    )
  }

  if (!focusedDoc) {
    return (
      <div className="flex w-96 shrink-0 flex-col border-l border-border bg-panel">
        <div className="flex flex-1 items-center justify-center px-4 py-16 text-xs text-muted">
          {t('common.selectDocHint')}
        </div>
        {toastMessage && (
          <div className="fixed bottom-4 right-4 z-50 rounded border border-border bg-panel px-3 py-2 text-xs text-foreground shadow-lg">
            {toastMessage}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel">
      <SingleDetail doc={focusedDoc} />
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 rounded border border-border bg-panel px-3 py-2 text-xs text-foreground shadow-lg">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
