import { net } from 'electron'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, unlinkSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join, basename, parse as parsePath } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Repositories } from '../db/repositories'
import type { Document, IdentifierImportResult, IdentifierType, MetadataSource } from '../../shared/ipc-types'
import { newId } from '../db/repositories/documents'
import { copyToLibrary } from './library'
import { logger } from './logger'
import {
  deriveDoiFromArxivId,
  findVerifiedArxivMetadata,
  normalizeArxivId,
  normalizeAuthors,
  parseCrossrefMessage,
  parseArxivEntry
} from './metadata'

const CONNECT_TIMEOUT_MS = 15_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
const MAX_REDIRECTS = 5
const PDF_MAGIC = '%PDF'

function isPrivateIp(ip: string): boolean {
  const normalized = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.+$/, '')

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedIpv4) return isPrivateIp(mappedIpv4[1])
  const mappedIpv4Hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedIpv4Hex) {
    const high = Number.parseInt(mappedIpv4Hex[1], 16)
    const low = Number.parseInt(mappedIpv4Hex[2], 16)
    return isPrivateIp(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`)
  }

  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
  }

  if (isIP(normalized) === 6) {
    return normalized === '::' ||
      normalized === '::1' ||
      /^f[cd][0-9a-f]{2}:/.test(normalized) ||
      /^fe[89ab][0-9a-f]:/.test(normalized) ||
      /^ff[0-9a-f]{2}:/.test(normalized)
  }

  return false
}

const DNS_TIMEOUT_MS = 3_000

interface PublicUrlResponse {
  status: number
  ok: boolean
  url: string
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export type PublicUrlTransport = (
  url: string,
  address: string,
  family: 4 | 6,
  signal: AbortSignal,
  headers: Record<string, string>
) => Promise<PublicUrlResponse>

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function resolvePublicAddress(urlStr: string): Promise<{ address: string; family: 4 | 6 }> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error('Download URL is invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Download URL is not HTTP(S)')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Download URL contains credentials')
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || isPrivateIp(hostname)) {
    throw new Error('Download URL resolves to a private address')
  }

  const directFamily = isIP(hostname)
  if (directFamily !== 0) {
    return { address: hostname, family: directFamily as 4 | 6 }
  }

  const records = await withTimeout(
    lookup(hostname, { all: true, verbatim: true }).catch(() => []),
    DNS_TIMEOUT_MS
  )
  if (records === null || records.length === 0) {
    throw new Error('Download URL could not be resolved')
  }
  if (records.some((record) => isPrivateIp(record.address))) {
    throw new Error('Download URL resolves to a private address')
  }
  const selected = records[0]
  return { address: selected.address, family: selected.family as 4 | 6 }
}

export async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    await resolvePublicAddress(urlStr)
    return true
  } catch {
    return false
  }
}

const pinnedRequest: PublicUrlTransport = (url, address, family, signal, headers) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const request = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(parsed, {
      method: 'GET',
      headers,
      signal,
      lookup: (_hostname, options, callback) => {
        const result = { address, family }
        if (options?.all) {
          callback(null, [result])
        } else {
          callback(null, address, family)
        }
      }
    }, (response) => {
      const responseHeaders = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(name, item)
        } else if (value !== undefined) {
          responseHeaders.set(name, String(value))
        }
      }
      const status = response.statusCode ?? 0
      resolve({
        status,
        ok: status >= 200 && status < 300,
        url,
        headers: responseHeaders,
        body: Readable.toWeb(response) as ReadableStream<Uint8Array>
      })
    })
    req.on('error', reject)
    req.end()
  })
}

export async function fetchPublicUrl(
  initialUrl: string,
  signal: AbortSignal,
  headers: Record<string, string>,
  transport: PublicUrlTransport = pinnedRequest
): Promise<PublicUrlResponse> {
  let currentUrl = initialUrl
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const { address, family } = await resolvePublicAddress(currentUrl)
    const response = await transport(currentUrl, address, family, signal, headers)
    if (response.status < 300 || response.status >= 400) return response

    const location = response.headers.get('location')
    if (!location) throw new Error(`Redirect response ${response.status} has no location`)
    if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects')
    await response.body?.cancel()
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new Error('Too many redirects')
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

  if (normalizeArxivId(trimmed)) return 'arxiv'

  if (/^[\d-]{9,17}[\dXx]$/.test(trimmed.replace(/\s/g, ''))) return 'isbn'

  return null
}

export function extractArxivId(input: string): string | null {
  return normalizeArxivId(input)
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
    const response = await fetchPublicUrl(
      `https://doi.org/${encodeURIComponent(doi)}`,
      controller.signal,
      { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    )
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/pdf')) {
      await response.body?.cancel()
      return response.url
    }
    await response.body?.cancel()
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
    const normalizedId = normalizeArxivId(arxivId)
    if (!entry || !normalizedId || entry.arxivId.replace(/v\d+$/i, '') !== normalizedId.replace(/v\d+$/i, '')) return null

    const pdfUrl = `https://arxiv.org/pdf/${normalizedId}.pdf`

    const data: Partial<Document> = {
      metadataSource: 'arxiv' as MetadataSource,
      title: entry.title,
      authors: normalizeAuthors(entry.authors),
      year: entry.year,
      abstract: entry.abstract,
      url: entry.id ?? `https://arxiv.org/abs/${normalizedId}`,
      doi: entry.doi ?? deriveDoiFromArxivId(normalizedId),
      arxivId: normalizedId
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
    const response = await fetchPublicUrl(
      url,
      controller.signal,
      { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
    )
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Download failed: no response body')
    }

    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error('Download failed: PDF exceeds the 512 MB limit')
    }

    const sourceStream = Readable.fromWeb(response.body as ReadableStream)
    let downloadedBytes = 0
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
        if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
          callback(new Error('Download failed: PDF exceeds the 512 MB limit'))
          return
        }
        resetIdleTimer()
        callback(null, chunk)
      }
    })

    await pipeline(sourceStream, limiter, createWriteStream(destPath, { flags: 'wx' }))

    const stat = statSync(destPath)
    if (stat.size < 100) {
      unlinkSync(destPath)
      throw new Error('Downloaded file is too small to be a valid PDF')
    }

    return destPath
  } catch (error) {
    try { unlinkSync(destPath) } catch { void 0 }
    throw error
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
    return n >= 4 && buf.toString('ascii', 0, 4) === PDF_MAGIC
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
    try {
      const verifiedArxiv = await findVerifiedArxivMetadata(metadata)
      if (verifiedArxiv?.arxivId) metadata.arxivId = verifiedArxiv.arxivId
    } catch (error) {
      logger.warn(`identifier:doi arxiv-crosscheck failed ${error instanceof Error ? error.message : String(error)}`)
    }
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

  const tmpDir = join(libraryFolder, '.tmp', newId())
  let tmpPath: string
  try {
    try {
      tmpPath = await downloadPdf(pdfUrl, tmpDir, tempFileName)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { added: [], message: `Failed to download PDF: ${msg}` }
    }

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
      originalFolderPath: libraryFolder,
      fileName: basename(tmpPath),
      fileSize,
      fileHash,
      title: meta?.title ?? null,
      authors: meta?.authors ?? null,
      affiliations: null,
      year: meta?.year ?? null,
      venue: meta?.venue ?? null,
      volume: meta?.volume ?? null,
      issue: meta?.issue ?? null,
      pages: meta?.pages ?? null,
      abstract: meta?.abstract ?? null,
      keywords: meta?.keywords ?? null,
      url: meta?.url ?? null,
      doi: meta?.doi ?? null,
      arxivId: meta?.arxivId ?? null,
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

    let newPath: string | null = null
    try {
      newPath = copyToLibrary(tmpPath, libraryFolder)
      repos.documents.updateFilePath(doc.id, newPath, parsePath(newPath).base)
    } catch {
      logger.warn(`identifier:copy-to-library failed ${tmpPath}`)
      try { repos.documents.delete(doc.id) } catch { void 0 }
      if (newPath) {
        try { unlinkSync(newPath) } catch { void 0 }
      }
      return { added: [], message: 'Failed to copy the downloaded PDF to the library folder.' }
    }

    logger.info(`identifier:added ${doc.id} from ${idType}`)
    return { added: [doc.id] }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { void 0 }
  }
}
