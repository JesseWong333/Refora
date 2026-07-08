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
  titleCandidate?: string | null
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const WORKER_TIMEOUT_MS = 60_000
const NET_TIMEOUT_MS = 8_000
const WORKER_IDLE_TIMEOUT_MS = 60_000

type MetadataJob = () => Promise<void>

const REFERENCE_HEADINGS = /references|bibliography|参考文献|参考资料|references\s*$/i
const DOI_REGEX = /10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+/g
const ARXIV_ID_REGEX = /(?:arxiv\s*:?\s*|arxiv\.org\/abs\/)(\d{4}\.\d{4,5}(?:v\d+)?)/i

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const TEMPLATE_NOISE_TITLE = /\b(formatting instructions|instructions for authors|template|sample manuscript|sample paper|untitled|main\.tex)\b/i

export function isTemplateNoiseTitle(title: string): boolean {
  return TEMPLATE_NOISE_TITLE.test(title)
}

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

const TITLE_NOISE_PATTERNS = /^(\s*(published as a|formatting instructions|instructions for authors)\b|\d{4}\s*(©|\(c\))\b|copyright\b|vol\.?\s*\d|article\b|contents lists available\b|journal homepage\b|science\s?direct\b|elsevier\b|springer\b|ieee\b|acm\b|arxiv:\s*\d)/i
const JOURNAL_RUNNING_HEADER = /\b\w+\s+\d+\s*\(\d{4}\)\s*\d+\s*$/i
const TITLE_NOISE_ANYWHERE = /\b(formatting instructions|instructions for authors|published as a conference paper)\b/i

function isTitleNoiseLine(line: string): boolean {
  const lower = line.toLowerCase()
  if (lower === 'arxiv' || lower.startsWith('arxiv:')) return true
  if (lower === 'abstract' || lower.startsWith('abstract')) return true
  if (lower.startsWith('http') || lower.startsWith('www.')) return true
  if (lower.startsWith('doi') || DOI_REGEX.test(line)) return true
  if (line.includes('@') && line.includes('.')) return true
  if (TITLE_NOISE_PATTERNS.test(line)) return true
  if (TITLE_NOISE_ANYWHERE.test(line)) return true
  if (JOURNAL_RUNNING_HEADER.test(line)) return true
  return false
}

function isLikelyTitleLine(line: string): boolean {
  if (line.length < 8) return false
  if (isTitleNoiseLine(line)) return false
  return true
}

const TITLE_CONTINUATION_END = /\b(for|and|the|of|with|using|via|in|on|to|a|an|from|by|as|over|into|towards|toward|based|via|through|across|against|with)\s*$/i
const ENDS_SENTENCE = /[.!?]$/

function looksLikeContinuation(prev: string, next: string): boolean {
  if (ENDS_SENTENCE.test(prev)) return false
  if (TITLE_CONTINUATION_END.test(prev)) return true
  if (/[:(\-—]$/.test(prev)) return true
  if (/^[a-z]/.test(next) && next.length < 80 && !/^(this|we|our|the|in|abstract)\b/i.test(next)) return true
  return false
}

const JOURNAL_HEADER_CONTEXT = /^(contents lists available|journal homepage|www\.)\b/i

function inJournalHeaderCluster(head: string[], i: number): boolean {
  for (let k = i + 1; k <= Math.min(head.length - 1, i + 3); k++) {
    if (JOURNAL_HEADER_CONTEXT.test(head[k])) return true
  }
  return false
}

export function extractTitleFromText(text: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const head = lines.slice(0, 12)
  for (let i = 0; i < head.length; i++) {
    const line = head[i]
    if (!isLikelyTitleLine(line)) continue
    if (inJournalHeaderCluster(head, i)) continue
    const titleLines = [line]
    for (let j = i + 1; j < head.length && titleLines.length < 4; j++) {
      const next = head[j]
      if (!isLikelyTitleLine(next)) break
      const last = titleLines[titleLines.length - 1]
      if (!looksLikeContinuation(last, next)) break
      titleLines.push(next)
    }
    return titleLines.join(' ').replace(/\s+/g, ' ').trim()
  }
  return null
}

const POSTER_KEYWORDS = /\b(poster|slide[s]?|presentation|keynote|tutorial|syllabus|preface|foreword|table of contents|index|appendix|chapter)\b/i
const NOISE_TITLE_PATTERNS = /^(figure|fig\.?|table|tab\.?|algorithm|theorem|lemma|proof|equation|eq\.?|section|sec\.?)\s*\d+/i

export function looksLikePosterOrNonPaper(text: string): boolean {
  const head = text.slice(0, 600).toLowerCase()
  if (POSTER_KEYWORDS.test(head)) return true
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 12) return false
  const headLines = lines.slice(0, 40)
  const shortLines = headLines.filter((l) => l.length > 0 && l.length < 40)
  if (shortLines.length / headLines.length > 0.8 && !/abstract/i.test(head)) {
    return true
  }
  return false
}

export function isReliableTitle(title: string | null, text: string): boolean {
  if (!title || title.trim().length === 0) return false
  const trimmed = title.trim()
  if (trimmed.length < 8) return false
  if (trimmed.length > 300) return false
  if (NOISE_TITLE_PATTERNS.test(trimmed)) return false
  if (looksLikePosterOrNonPaper(text)) return false
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (wordCount < 3) return false
  const alphaRatio = (trimmed.match(/[a-zA-Z]/g) ?? []).length / trimmed.length
  if (alphaRatio < 0.5) return false
  if (DOI_REGEX.test(trimmed)) return false
  return true
}

export function titleFromFileName(fileName: string): string | null {
  let base = fileName.replace(/\.pdf$/i, '').trim()
  if (base.length === 0) return null
  base = base.replace(/[_]+/g, ' ')
  base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  base = base.replace(/(\d{4})([A-Za-z])/g, '$1 $2')
  base = base.replace(/([A-Za-z])(\d{4})/g, '$1 $2')
  base = base.replace(/\s+/g, ' ').trim()
  if (base.length === 0) return null
  const words = base.split(' ').filter(Boolean)
  if (words.length === 0) return null
  if (/^\d+$/.test(words[0]) && words.length > 1) {
    words.shift()
  }
  const result = words.join(' ')
  if (result.length === 0) return null
  return result.charAt(0).toUpperCase() + result.slice(1)
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
    if (typeof fetchedVal === 'string' && fetchedVal.trim().length === 0) continue

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

async function fetchCrossref(doi: string, mailto: string): Promise<{ data: Partial<Document> } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const userAgent = mailto
      ? `Refora/0.1 (mailto:${mailto})`
      : 'Refora/0.1 (mailto:support@refora.app)'
    const response = await net.fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': userAgent }
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

async function fetchArxiv(id: string): Promise<{ data: Partial<Document>; confidence: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const text = await response.text()

    const entryMatch = text.match(/<entry>([\s\S]*?)<\/entry>/)
    if (!entryMatch) return null
    const entry = entryMatch[1]

    const titleMatch = entry.match(/<title>(.*?)<\/title>/s)
    const arxivTitle = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null
    if (!arxivTitle) return null

    const authorMatches = entry.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/gs)
    const authors = [...authorMatches].map((m) => m[1].trim()).join('; ') || null

    const yearMatch = entry.match(/<published>(\d{4})/)
    const year = yearMatch ? yearMatch[1] : null

    const abstractMatch = entry.match(/<summary>(.*?)<\/summary>/s)
    const abstractText = abstractMatch ? abstractMatch[1].trim().replace(/\s+/g, ' ') : null

    const idMatch = entry.match(/<id>(.*?)<\/id>/)
    const arxivUrl = idMatch ? idMatch[1].trim() : `https://arxiv.org/abs/${id}`

    return {
      data: {
        title: arxivTitle,
        authors: normalizeAuthors(authors),
        year,
        abstract: abstractText,
        url: arxivUrl,
        metadataSource: 'arxiv' as MetadataSource
      },
      confidence: 1
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function normalizeTitleForMatch(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitleForMatch(a)
  const nb = normalizeTitleForMatch(b)
  if (na.length === 0 || nb.length === 0) return 0
  if (na === nb) return 1

  const wordsA = na.split(' ').filter((w) => w.length > 0)
  const wordsB = nb.split(' ').filter((w) => w.length > 0)
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  const setA = new Set(wordsA)
  const common = wordsB.filter((w) => setA.has(w)).length
  const minLen = Math.min(wordsA.length, wordsB.length)
  const overlap = common / minLen

  const shorter = na.length < nb.length ? na : nb
  const longer = na.length < nb.length ? nb : na
  let prefixScore = 0
  if (longer.startsWith(shorter)) {
    prefixScore = shorter.length / longer.length
  }

  let lengthPenalty = 1
  if (shorter.length < longer.length * 0.5) {
    lengthPenalty = shorter.length / (longer.length * 0.5)
  }

  return Math.max(overlap, prefixScore) * lengthPenalty
}

const TITLE_SIMILARITY_THRESHOLD = 0.6
const TITLE_USE_THRESHOLD = 0.75

export function titlesMatch(a: string, b: string): boolean {
  return titleSimilarity(a, b) >= TITLE_SIMILARITY_THRESHOLD
}

async function fetchDblpByTitle(title: string): Promise<{ data: Partial<Document>; confidence: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const url = `https://dblp.org/search/publ/api?q=${encodeURIComponent(title)}&format=json&h=1`
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    })
    if (!response.ok) return null
    const body = await response.json() as {
      result?: {
        hits?: {
          hit?: Array<{
            '@score'?: string
            info?: {
              title?: string
              authors?: { author?: Array<{ text?: string }> | { text?: string } }
              year?: string
              venue?: string
              volume?: string
              pages?: string
              doi?: string
              ee?: string
              type?: string
            }
          }>
        }
      }
    }

    const hits = body.result?.hits?.hit
    if (!hits || hits.length === 0) return null
    const hit = hits[0]
    const info = hit.info
    if (!info?.title) return null

    const confidence = titleSimilarity(title, info.title)
    if (confidence < TITLE_SIMILARITY_THRESHOLD) return null

    const rawAuthors = info.authors?.author
    let authors: string | null = null
    if (Array.isArray(rawAuthors)) {
      authors = rawAuthors.map((a) => a.text ?? '').filter(Boolean).join('; ') || null
    } else if (rawAuthors?.text) {
      authors = rawAuthors.text
    }

    const year = nonEmptyString(info.year) ?? null
    const venue = nonEmptyString(info.venue) ?? null
    const volume = nonEmptyString(info.volume) ?? null
    const doi = nonEmptyString(info.doi) ?? null
    const ee = nonEmptyString(info.ee) ?? null
    const url2 = ee ?? doi ? (doi ? `https://doi.org/${doi}` : ee ?? null) : null

    return {
      data: {
        title: info.title.replace(/\.\s*$/, ''),
        authors: normalizeAuthors(authors),
        year,
        venue,
        volume,
        doi,
        url: url2,
        metadataSource: 'dblp' as MetadataSource
      },
      confidence
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArxivByTitle(title: string): Promise<{ data: Partial<Document>; confidence: number } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), NET_TIMEOUT_MS)

  try {
    const url = `https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent(`"${title}"`)}&max_results=1`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const text = await response.text()

    const entryMatch = text.match(/<entry>([\s\S]*?)<\/entry>/)
    if (!entryMatch) return null
    const entry = entryMatch[1]

    const titleMatch = entry.match(/<title>(.*?)<\/title>/s)
    const arxivTitle = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : null
    if (!arxivTitle) return null

    const confidence = titleSimilarity(title, arxivTitle)
    if (confidence < TITLE_SIMILARITY_THRESHOLD) return null

    const authorMatches = entry.matchAll(/<author>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/author>/gs)
    const authors = [...authorMatches].map((m) => m[1].trim()).join('; ') || null

    const yearMatch = entry.match(/<published>(\d{4})/)
    const year = yearMatch ? yearMatch[1] : null

    const abstractMatch = entry.match(/<summary>(.*?)<\/summary>/s)
    const abstractText = abstractMatch ? abstractMatch[1].trim().replace(/\s+/g, ' ') : null

    const idMatch = entry.match(/<id>(.*?)<\/id>/)
    const arxivUrl = idMatch ? idMatch[1].trim() : null

    return {
      data: {
        title: arxivTitle,
        authors: normalizeAuthors(authors),
        year,
        abstract: abstractText,
        url: arxivUrl,
        metadataSource: 'arxiv' as MetadataSource
      },
      confidence
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function createMetadataService(repos: Repositories, win: BrowserWindow | (() => BrowserWindow | null)) {
  let worker: ReturnType<typeof utilityProcess.fork> | null = null
  let workerKilled = false
  let workerIdleTimer: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<string, PendingRequest>()
  const jobQueue: MetadataJob[] = []
  let activeJobs = 0
  const MAX_CONCURRENT = 3
  let lastCrossrefMs = 0
  let lastArxivMs = 0
  let lastDblpMs = 0
  let processing = false

  const getWin = (): BrowserWindow | null => {
    const w = typeof win === 'function' ? win() : win
    if (!w || w.isDestroyed()) return null
    return w
  }

  function emitFailedUpdate(docId: string): void {
    const w = getWin()
    if (!w) return
    const updated = repos.documents.get(docId)
    if (updated) emitDocumentUpdated(w, updated)
  }

  function scheduleIdleKill(): void {
    if (workerIdleTimer) clearTimeout(workerIdleTimer)
    workerIdleTimer = setTimeout(() => {
      if (pending.size === 0 && activeJobs === 0) {
        if (worker && !workerKilled) {
          logger.info('metadata-worker:idle-kill')
          worker.kill()
          workerKilled = true
          worker = null
        }
      }
    }, WORKER_IDLE_TIMEOUT_MS)
  }

  function ensureWorker(): ReturnType<typeof utilityProcess.fork> {
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
    if (worker && !workerKilled) return worker
    worker = utilityProcess.fork(join(__dirname, 'worker/pdf-worker.js'), [], {
      serviceName: 'Metadata Worker',
      stdio: 'pipe'
    })
    workerKilled = false
    worker.on('message', (msg: WorkerResponse) => {
      logger.info(`metadata-worker:message corr=${msg.correlationId}${msg.error ? ` error=${msg.error.type}` : ''}`)
      const req = pending.get(msg.correlationId)
      if (req) {
        clearTimeout(req.timer)
        pending.delete(msg.correlationId)
        req.resolve(msg)
      }
    })
    worker.on('exit', (code) => {
      logger.warn(`metadata-worker:exit code=${code} pending=${pending.size}`)
      if (workerIdleTimer) {
        clearTimeout(workerIdleTimer)
        workerIdleTimer = null
      }
      for (const [, req] of pending) {
        clearTimeout(req.timer)
        req.reject(new Error('Metadata worker exited unexpectedly'))
      }
      pending.clear()
      worker = null
      workerKilled = true
    })
    if (worker.stderr) {
      worker.stderr.on('data', (chunk: Buffer) => {
        logger.error(`metadata-worker:stderr ${chunk.toString().trim()}`)
      })
    }
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
    } else if (source === 'dblp') {
      const elapsed = now - lastDblpMs
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed))
      }
      lastDblpMs = Date.now()
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
    if (!doc) {
      logger.warn(`metadata:processJob doc-not-found id=${docId}`)
      return
    }

    const existingStatus = doc.metadataStatus
    if (existingStatus === 'done') {
      logger.info(`metadata:processJob skip-done id=${docId}`)
      return
    }
    logger.info(`metadata:processJob start id=${docId} status=${existingStatus} path=${doc.filePath}`)

    let workerResponse: WorkerResponse
    try {
      workerResponse = await requestParse(doc.filePath)
    } catch (e) {
      logger.warn(`metadata:processJob parse-failed id=${docId}: ${e instanceof Error ? e.message : String(e)}`)
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      emitFailedUpdate(docId)
      return
    }

    if (workerResponse.error) {
      logger.warn(`metadata:processJob worker-error id=${docId} type=${workerResponse.error.type} msg=${workerResponse.error.message}`)
      repos.documents.incrementMetadataAttempts(docId)
      repos.documents.setMetadataStatus(docId, 'failed')
      emitFailedUpdate(docId)
      return
    }

    const info = workerResponse.info ?? {}
    const text = workerResponse.text ?? ''
    const titleCandidate = workerResponse.titleCandidate ?? null

    let doi = extractDoiFromInfo(info)
    if (!doi) {
      doi = extractDoiFromText(text)
    }
    logger.info(`metadata:processJob parsed id=${docId} doi=${doi} textLen=${text.length} candidate=${JSON.stringify(titleCandidate).slice(0, 60)}`)

    const infoTitle = nonEmptyString(info['Title']) ?? nonEmptyString(info['title'])
    const candidateTitle = isReliableTitle(titleCandidate, text) ? titleCandidate : null
    const infoTitleIsTemplate = infoTitle !== null && isTemplateNoiseTitle(infoTitle)
    const effectiveInfoTitle = infoTitleIsTemplate ? null : infoTitle
    const textTitle = effectiveInfoTitle ?? candidateTitle ?? extractTitleFromText(text)
    const fileNameTitle = titleFromFileName(doc.fileName)
    const reliable = isReliableTitle(textTitle, text)
    const searchTitle = reliable ? textTitle : null
    const fallbackTitle = reliable ? (textTitle ?? fileNameTitle) : (fileNameTitle ?? textTitle)
    logger.info(`metadata:processJob title id=${docId} text=${JSON.stringify(textTitle).slice(0, 60)} candidate=${JSON.stringify(candidateTitle).slice(0, 60)} file=${JSON.stringify(fileNameTitle).slice(0, 60)} reliable=${reliable}`)

    let fetchedData: Partial<Document> | null = null
    let source: MetadataSource = 'pdf'

    if (doi) {
      await rateGate('crossref')
      const mailto = repos.settings.get<string>('crossrefMailto', '')
      const result = await fetchCrossref(doi, mailto)
      logger.info(`metadata:processJob crossref id=${docId} ok=${!!result}`)
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
        logger.info(`metadata:processJob arxiv id=${docId} ok=${!!result}`)
        if (result && isReliableTitle(result.data.title ?? null, text)) {
          if (textTitle && titleSimilarity(textTitle, result.data.title ?? '') < TITLE_SIMILARITY_THRESHOLD) {
            logger.info(`metadata:processJob arxiv id=${docId} mismatch title=${JSON.stringify(result.data.title).slice(0, 60)} vs text=${JSON.stringify(textTitle).slice(0, 60)}`)
          } else {
            fetchedData = result.data
            source = 'arxiv'
          }
        }
      }
    }

    if (!fetchedData && searchTitle) {
      logger.info(`metadata:processJob title-search id=${docId} title=${JSON.stringify(searchTitle).slice(0, 80)}`)
      let weakMatch = false
      await rateGate('dblp')
      const dblpResult = await fetchDblpByTitle(searchTitle)
      logger.info(`metadata:processJob dblp id=${docId} ok=${!!dblpResult}${dblpResult ? ` confidence=${dblpResult.confidence.toFixed(2)}` : ''}`)
      if (dblpResult) {
        if (dblpResult.confidence >= TITLE_USE_THRESHOLD) {
          fetchedData = dblpResult.data
          source = 'dblp'
        } else {
          weakMatch = true
        }
      }
      if (!fetchedData) {
        await rateGate('arxiv')
        const arxivResult = await fetchArxivByTitle(searchTitle)
        logger.info(`metadata:processJob arxiv-title id=${docId} ok=${!!arxivResult}${arxivResult ? ` confidence=${arxivResult.confidence.toFixed(2)}` : ''}`)
        if (arxivResult) {
          if (arxivResult.confidence >= TITLE_USE_THRESHOLD) {
            fetchedData = arxivResult.data
            source = 'arxiv'
          } else {
            weakMatch = true
          }
        }
      }
      if (weakMatch) {
        logger.info(`metadata:processJob weak-match id=${docId} will use filename`)
      }
    }

    if (!fetchedData) {
      const authorsFromInfo = nonEmptyString(info['Author']) ?? nonEmptyString(info['author'])
      const finalTitle = fileNameTitle ?? fallbackTitle
      fetchedData = {
        title: finalTitle,
        authors: authorsFromInfo,
        metadataSource: 'pdf' as MetadataSource
      }
      source = 'pdf'
    }

    const current = repos.documents.get(docId)
    if (!current) return

    const { patch, remoteValues } = mergeMetadata(current, fetchedData)
    logger.info(`metadata:processJob merge id=${docId} patchKeys=${Object.keys(patch).join(',') || 'none'} remoteKeys=${Object.keys(remoteValues).join(',') || 'none'}`)
    repos.documents.applyMetadataFields(docId, patch, remoteValues, 'done', source)

    const updated = repos.documents.get(docId)
    const w = getWin()
    if (updated && w) {
      emitDocumentUpdated(w, updated)
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
          if (activeJobs === 0 && jobQueue.length === 0) {
            scheduleIdleKill()
          }
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
    if (workerIdleTimer) {
      clearTimeout(workerIdleTimer)
      workerIdleTimer = null
    }
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
