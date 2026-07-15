import { net } from 'electron'
import { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename, parse as parsePath } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { resolve4, resolve6 } from 'node:dns/promises'
import type { Repositories } from '../db/repositories'
import type { Document, IdentifierImportResult, IdentifierType, MetadataSource } from '../../shared/ipc-types'
import { newId } from '../db/repositories/documents'
import { copyToLibrary } from './library'
import { logger } from './logger'
import { normalizeAuthors, parseCrossrefMessage, parseArxivEntry } from './metadata'

const CONNECT_TIMEOUT_MS = 15_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const PDF_MAGIC = '%PDF'

const PRIVATE_HOST_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
  /^fd/,
  /^::$/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
]

function isPrivateIp(ip: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((p) => p.test(ip))
}

const DNS_TIMEOUT_MS = 3_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<T | null>((resolve) => setTimeout(() => resolve(null), ms))
  ])
}

export async function isSafeUrl(urlStr: string): Promise<boolean> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const hostname = parsed.hostname
  if (hostname === 'localhost') return false
  if (isPrivateIp(hostname)) return false

  const ipv4Records = await withTimeout(resolve4(hostname).catch(() => []), DNS_TIMEOUT_MS)
  if (ipv4Records && ipv4Records.some(isPrivateIp)) return false

  const ipv6Records = await withTimeout(resolve6(hostname).catch(() => []), DNS_TIMEOUT_MS)
  if (ipv6Records && ipv6Records.some(isPrivateIp)) return false

  return true
}

export function detectIdentifierType(input: string): IdentifierType | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    if (lower.includes('arxiv.org')) return 'arxiv'
    if (lower.includes('doi.org')) return 'doi'
    return 'url'
  }

  if (/^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+$/.test(trimmed)) return 'doi'

  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) return 'arxiv'
  if (/^(?:arxiv\s*:?\s*)?\d{4}\.\d{4,5}(v\d+)?$/i.test(trimmed)) return 'arxiv'

  if (/^[\d-]{9,17}[\dXx]$/.test(trimmed.replace(/\s/g, ''))) return 'isbn'

  return null
}

export function extractArxivId(input: string): string | null {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      if (url.hostname.includes('arxiv.org')) {
        const absMatch = url.pathname.match(/\/abs\/([^/?#]+)/)
        if (absMatch) return absMatch[1]
        const pdfMatch = url.pathname.match(/\/pdf\/([^/?#]+)/)
        if (pdfMatch) return pdfMatch[1].replace(/\.pdf$/, '')
      }
    } catch {
      return null
    }
    return null
  }

  const m = trimmed.match(/(\d{4}\.\d{4,5}(?:v\d+)?)/)
  return m ? m[1] : null
}

export function extractDoi(input: string): string | null {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      const url = new URL(trimmed)
      if (url.hostname.includes('doi.org')) {
        const doi = decodeURIComponent(url.pathname.slice(1))
        if (doi) return doi
      }
    } catch {
      return null
    }
  }

  if (/^10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+$/.test(trimmed)) return trimmed

  const m = trimmed.match(/(10\.\d{4,9}\/[-._;()/:a-zA-Z0-9+]+)/)
  return m ? m[1] : null
}

interface CrossrefResult {
  data: Partial<Document>
  pdfUrl?: string | null
}

async function fetchCrossrefByDoi(doi: string, mailto: string): Promise<CrossrefResult | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

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
      message?: Parameters<typeof parseCrossrefMessage>[0] & {
        link?: Array<{ URL?: string; 'content-type'?: string }>
      }
    }
    const msg = body.message
    if (!msg) return null

    const data = parseCrossrefMessage(msg)
    if (!data) return null

    const pdfLink = msg.link?.find((l) => l['content-type'] === 'application/pdf')
    const pdfUrl = pdfLink?.URL ?? null

    return { data, pdfUrl }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function resolveDoiPdfUrl(doi: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

  try {
    const response = await net.fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/pdf')) {
      return response.url
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchArxivMetadata(arxivId: string): Promise<{ data: Partial<Document>; pdfUrl: string } | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)

  try {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    const text = await response.text()

    const entry = parseArxivEntry(text)
    if (!entry) return null

    const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`

    const data: Partial<Document> = {
      metadataSource: 'arxiv' as MetadataSource,
      title: entry.title,
      authors: normalizeAuthors(entry.authors),
      year: entry.year,
      abstract: entry.abstract,
      url: entry.id ?? `https://arxiv.org/abs/${arxivId}`
    }

    return { data, pdfUrl }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function sanitizeFileName(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*]/g, '')
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
  return cleaned.length > 0 ? cleaned : 'download'
}

function streamHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(null))
  })
}

async function downloadPdf(url: string, destDir: string, fileName: string): Promise<string> {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }
  const destPath = join(destDir, fileName)

  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_TIMEOUT_MS)
  }

  try {
    const response = await net.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    })
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Download failed: no response body')
    }

    const sourceStream = Readable.fromWeb(response.body as ReadableStream)
    sourceStream.on('data', () => resetIdleTimer())

    await pipeline(sourceStream, createWriteStream(destPath))

    const stat = statSync(destPath)
    if (stat.size < 100) {
      unlinkSync(destPath)
      throw new Error('Downloaded file is too small to be a valid PDF')
    }

    return destPath
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

function isPdfFile(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(5)
    const n = readSync(fd, buf, 0, 5, 0)
    closeSync(fd)
    return n >= 5 && buf.toString('ascii', 0, 5) === PDF_MAGIC
  } catch {
    return false
  }
}

export interface IdentifierImporterDeps {
  repos: Repositories
  getLibraryFolder: () => string
}

export async function importFromIdentifier(
  deps: IdentifierImporterDeps,
  rawInput: string
): Promise<IdentifierImportResult> {
  const { repos, getLibraryFolder } = deps
  const input = rawInput.trim()

  if (!input) {
    return { added: [], message: 'Identifier is empty' }
  }

  const idType = detectIdentifierType(input)
  if (!idType) {
    return { added: [], message: `Could not recognize identifier: "${input}"` }
  }

  const libraryFolder = getLibraryFolder()
  if (!libraryFolder) {
    return { added: [], message: 'Library folder is not configured. Please set it in Settings first.' }
  }

  let metadata: Partial<Document> | null = null
  let pdfUrl: string | null = null
  let tempFileName: string = 'download.pdf'

  if (idType === 'arxiv') {
    const arxivId = extractArxivId(input)
    if (!arxivId) {
      return { added: [], message: `Could not extract arXiv ID from: "${input}"` }
    }
    logger.info(`identifier:arxiv id=${arxivId}`)
    const result = await fetchArxivMetadata(arxivId)
    if (!result) {
      return { added: [], message: `Could not fetch arXiv metadata for: ${arxivId}` }
    }
    metadata = result.data
    pdfUrl = result.pdfUrl
    tempFileName = `${sanitizeFileName(metadata.title ?? arxivId)}.pdf`
  } else if (idType === 'doi') {
    const doi = extractDoi(input)
    if (!doi) {
      return { added: [], message: `Could not extract DOI from: "${input}"` }
    }
    logger.info(`identifier:doi doi=${doi}`)
    const mailto = repos.settings.get<string>('crossrefMailto', '')
    const crossrefResult = await fetchCrossrefByDoi(doi, mailto)
    if (!crossrefResult) {
      return { added: [], message: `Could not fetch Crossref metadata for DOI: ${doi}` }
    }
    metadata = crossrefResult.data
    pdfUrl = crossrefResult.pdfUrl ?? null
    if (!pdfUrl) {
      pdfUrl = await resolveDoiPdfUrl(doi)
    }
    tempFileName = `${sanitizeFileName(metadata.title ?? doi.replace('/', '_'))}.pdf`
  } else if (idType === 'url') {
    logger.info(`identifier:url url=${input}`)
    pdfUrl = input
    const urlPath = parsePath(new URL(input).pathname).base
    tempFileName = urlPath.endsWith('.pdf') ? urlPath : 'download.pdf'
  } else if (idType === 'isbn') {
    return { added: [], message: 'ISBN import is not supported yet. Please use a DOI or arXiv ID.' }
  }

  if (!pdfUrl) {
    return { added: [], message: 'Could not find a downloadable PDF for this identifier.' }
  }

  if (!(await isSafeUrl(pdfUrl))) {
    return { added: [], message: 'The download URL is not allowed (must be a public http(s) address).' }
  }

  const tmpDir = join(libraryFolder, '.tmp')
  let tmpPath: string | null = null
  try {
    tmpPath = await downloadPdf(pdfUrl, tmpDir, tempFileName)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { added: [], message: `Failed to download PDF: ${msg}` }
  }

  try {
    if (!isPdfFile(tmpPath)) {
      return { added: [], message: 'Downloaded file is not a valid PDF.' }
    }

    const fileHash = await streamHash(tmpPath)
    if (fileHash) {
      const hashDup = repos.documents.findByHash(fileHash)
      if (hashDup) {
        return { added: [], message: 'This file is already in your library.' }
      }
    }

    const fileSize = statSync(tmpPath).size
    const now = Date.now()
    const meta = metadata

    const doc = repos.documents.insert({
      id: newId(),
      filePath: tmpPath,
      originalFolderPath: tmpDir,
      fileName: basename(tmpPath),
      fileSize,
      fileHash,
      title: meta?.title ?? null,
      authors: meta?.authors ?? null,
      year: meta?.year ?? null,
      venue: meta?.venue ?? null,
      volume: meta?.volume ?? null,
      issue: meta?.issue ?? null,
      pages: meta?.pages ?? null,
      abstract: meta?.abstract ?? null,
      keywords: meta?.keywords ?? null,
      url: meta?.url ?? null,
      doi: meta?.doi ?? null,
      note: null,
      starred: 0,
      addedAt: now,
      lastReadAt: null,
      updatedAt: now,
      metadataSource: meta?.metadataSource ?? null,
      metadataStatus: 'done',
      metadataAttempts: 0,
      editedFields: [],
      remoteValues: null,
      fileMissing: 0
    })

    try {
      const newPath = copyToLibrary(tmpPath, libraryFolder)
      repos.documents.updateFilePath(doc.id, newPath, parsePath(newPath).base)
    } catch {
      logger.warn(`identifier:copy-to-library failed ${tmpPath}`)
      try { repos.documents.delete(doc.id) } catch { void 0 }
      return { added: [], message: 'Failed to copy the downloaded PDF to the library folder.' }
    }

    logger.info(`identifier:added ${doc.id} from ${idType}`)
    return { added: [doc.id] }
  } finally {
    if (tmpPath) {
      try { unlinkSync(tmpPath) } catch { void 0 }
    }
  }
}
