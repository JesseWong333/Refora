import { type BrowserWindow, utilityProcess, net } from 'electron'
import { join } from 'node:path'
import type { Repositories } from '../db/repositories'
import type { Document, DocumentPatch, EditableField, MetadataSource, RemoteValues } from '../../shared/ipc-types'
import { newId } from '../db/repositories/documents'
import { emitDocumentUpdated } from '../ipc/events'
import { logger } from './logger'

interface WorkerResponse {
  correlationId: string
  error?: { type: string; message: string }
  fileHash?: string | null
  info?: Record<string, unknown>
  text?: string
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WORKER_TIMEOUT_MS = 60_000
const NET_TIMEOUT_MS = 8_000

type MetadataJob = () => Promise<void>

const REFERENCE_HEADINGS = /references|bibliography|参考文献|参考资料|references\s*$/i
const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+/g
const ARXIV_ID_REGEX = /(?:arxiv\s*:?\s*|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?)/i

export function extractDoiFromText(text: string): string | null {
  const lines = text.split('\n')
  let inReferences = false
  let firstMatch: string | null = null

  for (const line of lines) {
    if (REFERENCE_HEADINGS.test(line.trim())) {
      inReferences = true
      continue
    }
    if (inReferences) continue

    const match = line.match(DOI_REGEX)
    if (match && !firstMatch) {
      firstMatch = match[0]
    }
  }

  return firstMatch
}

export function extractDoiFromInfo(info: Record<string, unknown>): string | null {
  const raw = info['doi'] ?? info['DOI'] ?? info['Doi'] ?? null
  if (typeof raw !== 'string' || raw.length === 0) return null
  return raw.trim()
}

export function extractArxivFromText(text: string): string | null {
  const match = text.match(ARXIV_ID_REGEX)
  return match ? match[1] : null
}

export function normalizeAuthors(raw: string | null): string | null {
  if (!raw || raw.trim().length === 0) return null
  const parts = raw.split(';').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return null
  return parts.map((p) => {
    if (p.includes(',')) return p
    const spaceIdx = p.lastIndexOf(' ')
    if (spaceIdx === -1) return p
    return p.slice(spaceIdx + 1) + ', ' + p.slice(0, spaceIdx)
  }).join('; ')
}

export function mergeMetadata(
  current: Document,
  fetched: Partial<Document>
): { patch: DocumentPatch; remoteValues: RemoteValues } {
  const editableFields: EditableField[] = [
    'title', 'authors', 'year', 'venue', 'volume',
    'abstract', 'keywords', 'url', 'doi', 'note'
  ]
  const patch: DocumentPatch = {}
  const remoteValues: RemoteValues = {}
  const edited = new Set(current.editedFields)

  for (const field of editableFields) {
    const fetchedVal = fetched[field]
    if (fetchedVal === undefined || fetchedVal === null) continue

    const source: MetadataSource = fetched.metadataSource ?? 'crossref'
    remoteValues[field] = { value: String(fetchedVal), source }

    if (edited.has(field)) {
      const currentVal = current[field]
      if (currentVal !== null && currentVal !== undefined && currentVal !== '') continue
    }

    patch[field] = fetchedVal
  }

  return { patch, remoteValues }
}

async function fetchCrossref(doi: string): Promise<{ data: Partial<Document> } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const response = await net.fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ScholarNote/0.1 (mailto:support@scholarnote.app)' }
    })
    if (!response.ok) return null
    const body = await response.json() as {
      message?: {
        title?: string[]
        author?: Array<{ family?: string; given?: string; name?: string }>
        'published-print'?: { 'date-parts'?: number[][] }
        'published-online'?: { 'date-parts'?: number[][] }
        'container-title'?: string[]
        volume?: string
        abstract?: string
        subject?: string[]
        URL?: string
        DOI?: string
      }
    }
    const msg = body.message
    if (!msg) return null

    const title = msg.title?.[0] ?? null
    const authors = msg.author
      ? msg.author.map((a) => {
        const family = a.family ?? ''
        const given = a.given ?? ''
        if (family && given) return `${family}, ${given}`
        return a.name ?? ''
      }).filter(Boolean).join('; ')
      : null
    const dateParts = msg['published-print']?.['date-parts']?.[0] ?? msg['published-online']?.['date-parts']?.[0]
    const year = dateParts?.[0]?.toString() ?? null
    const venue = msg['container-title']?.[0] ?? null
    const volume = msg.volume ?? null
    const abstractText = msg.abstract ?? null
    const keywords = msg.subject?.join(', ') ?? null
    const url = msg.URL ?? null
    const doiVal = msg.DOI ?? null

    return {
      data: {
        title,
        authors: normalizeAuthors(authors),
        year,
        venue,
        volume,
        abstract: abstractText,
        keywords,
        url,
        doi: doiVal,
        metadataSource: 'crossref' as MetadataSource
      }
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArxiv(id: string): Promise<{ data: Partial<Document> } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const text = await response.text()

    const titleMatch = text.match(/<title>(.*?)<\/title>/)
    const title = titleMatch ? titleMatch[1].trim() : null

    const authorMatches = text.matchAll(/<author>.*?<name>(.*?)<\/name>.*?<\/author>/gs)
    const authors = [...authorMatches].map((m) => m[1]).join('; ') || null

    const yearMatch = text.match(/<published>(\d{4})/)
    const year = yearMatch ? yearMatch[1] : null

    const abstractMatch = text.match(/<summary>(.*?)<\/summary>/s)
    const abstractText = abstractMatch ? abstractMatch[1].trim().replace(/\s+/g, ' ') : null

    const urlMatch = text.match(/<id>(.*?)<\/id>/)
    const arxivUrl = urlMatch ? urlMatch[1].trim() : `https://arxiv.org/abs/${id}`

    return {
      data: {
        title,
        authors: normalizeAuthors(authors),
        year,
        abstract: abstractText,
        url: arxivUrl,
        metadataSource: 'arxiv' as MetadataSource
      }
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function createMetadataService(repos: Repositories, win: BrowserWindow) {
  let worker: ReturnType<typeof utilityProcess.fork> | null = null
  let workerKilled = false
  const pending = new Map<string, PendingRequest>()
  const jobQueue: MetadataJob[] = []
  let activeJobs = 0
  const MAX_CONCURRENT = 3
  let lastCrossrefMs = 0
  let lastArxivMs = 0
  let processing = false

  function ensureWorker(): ReturnType<typeof utilityProcess.fork> {
    if (worker && !workerKilled) return worker
    worker = utilityProcess.fork(join(__dirname, 'worker/pdf-worker.js'), [], {
      serviceName: 'Metadata Worker'
    })
    worker.on('message', (msg: WorkerResponse) => {
      const req = pending.get(msg.correlationId)
      if (req) {
        clearTimeout(req.timer)
        pending.delete(msg.correlationId)
        req.resolve(msg)
      }
    })
    worker.on('exit', () => {
      for (const [, req] of pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Metadata worker exited unexpectedly'))
      }
      pending.clear()
      worker = null
      workerKilled = true
    })
    logger.info('metadata-worker:started')
    return worker
  }

  function requestParse(filePath: string): Promise<WorkerResponse> {
    const w = ensureWorker()
    const correlationId = newId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(correlationId)
        reject(new Error(`Metadata worker request timed out: ${filePath}`))
      }, WORKER_TIMEOUT_MS)
      pending.set(correlationId, { resolve, reject, timer })
      w.postMessage({ correlationId, filePath })
    })
  }

  async function rateGate(source: MetadataSource): Promise<void> {
    const now = Date.now()
    if (source === 'arxiv') {
      const elapsed = now - lastArxivMs
      if (elapsed < 3000) {
        await new Promise((r) => setTimeout(r, 3000 - elapsed))
      }
      lastArxivMs = Date.now()
    } else {
      const elapsed = now - lastCrossrefMs
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed))
      }
      lastCrossrefMs = Date.now()
    }
  }

  async function processJob(docId: string): Promise<void> {
    const doc = repos.documents.get(docId)
    if (!doc) return

    const existingStatus = doc.metadataStatus
    if (existingStatus === 'done') return

    let workerResponse: WorkerResponse
    try {
      workerResponse = await requestParse(doc.filePath)
    } catch {
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      return
    }

    if (workerResponse.error) {
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      return
    }

    const info = workerResponse.info ?? {}
    const text = workerResponse.text ?? ''

    let doi = extractDoiFromInfo(info)
    if (!doi) {
      doi = extractDoiFromText(text)
    }

    let fetchedData: Partial<Document> | null = null
    let source: MetadataSource = 'pdf'

    if (doi) {
      await rateGate('crossref')
      const result = await fetchCrossref(doi)
      if (result) {
        fetchedData = result.data
        source = 'crossref'
      }
    }

    if (!fetchedData) {
      const arxivId = extractArxivFromText(text)
      if (arxivId) {
        await rateGate('arxiv')
        const result = await fetchArxiv(arxivId)
        if (result) {
          fetchedData = result.data
          source = 'arxiv'
        }
      }
    }

    if (!fetchedData) {
      fetchedData = {
        title: (info['Title'] as string) ?? (info['title'] as string) ?? null
      }
      source = 'pdf'
    }

    const current = repos.documents.get(docId)
    if (!current) return

    const { patch, remoteValues } = mergeMetadata(current, fetchedData)
    repos.documents.applyMetadataFields(docId, patch, remoteValues, 'done', source)

    const updated = repos.documents.get(docId)
    if (updated && !win.isDestroyed()) {
      emitDocumentUpdated(win, updated)
    }
  }

  async function processQueue(): Promise<void> {
    if (processing) return
    processing = true
    while (activeJobs < MAX_CONCURRENT && jobQueue.length > 0) {
      const job = jobQueue.shift()
      if (!job) break
      activeJobs++
      job()
        .catch((e) => {
          logger.error(`metadata:job-error: ${e instanceof Error ? e.message : String(e)}`)
        })
        .finally(() => {
          activeJobs--
          void processQueue()
        })
    }
    processing = false
  }

  function enqueue(docId: string): void {
    const doc = repos.documents.get(docId)
    if (!doc) return
    if (doc.metadataStatus === 'done') return

    jobQueue.push(async () => {
      await processJob(docId)
    })
    void processQueue()
  }

  function refreshMetadata(docId: string): void {
    repos.documents.setMetadataStatus(docId, 'pending')
    enqueue(docId)
  }

  function bulkRefreshMetadata(ids: string[]): void {
    for (const id of ids) {
      repos.documents.setMetadataStatus(id, 'pending')
      enqueue(id)
    }
  }

  function resumeOnStartup(): void {
    const rows = repos.documents.getResumableMetadataRows()
    logger.info(`metadata:resume ${rows.length} rows`)
    for (const row of rows) {
      enqueue(row.id)
    }
  }

  function destroy(): void {
    if (worker && !workerKilled) {
      worker.kill()
      workerKilled = true
      worker = null
    }
    pending.clear()
    jobQueue.length = 0
    activeJobs = 0
  }

  return {
    enqueue,
    refreshMetadata,
    bulkRefreshMetadata,
    resumeOnStartup,
    destroy
  }
}
