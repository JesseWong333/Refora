import { createReadStream, statSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
const parentPort = process.parentPort

interface WorkerRequest {
  correlationId: string
  filePath: string
  maxPages?: number
}

interface WorkerResponse {
  correlationId: string
  error?: { type: 'encrypted' | 'corrupted' | 'other'; message: string }
  fileHash?: string | null
  info?: Record<string, unknown>
  text?: string
  titleCandidate?: string | null
}

export function streamHash(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', () => resolve(null))
  })
}

export interface TextItem {
  str: string
  transform?: number[]
  height?: number
}

export interface LineInfo {
  text: string
  y: number
  size: number
}

export function buildLines(items: TextItem[]): LineInfo[] {
  const lines: LineInfo[] = []
  let current: TextItem[] = []
  let lastY: number | null = null
  for (const item of items) {
    const y = item.transform ? item.transform[5] : null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
      lines.push(makeLine(current))
      current = []
    }
    current.push(item)
    lastY = y
  }
  if (current.length > 0) lines.push(makeLine(current))
  return lines
}

export function makeLine(parts: TextItem[]): LineInfo {
  const text = parts.map((p) => p.str).join('').replace(/\s+/g, ' ').trim()
  const y = parts[0]?.transform ? parts[0].transform[5] : 0
  const size = parts.reduce((max, p) => {
    if (p.transform) {
      const a = p.transform[0]
      const b = p.transform[1]
      const s = Math.sqrt(a * a + b * b)
      return Math.max(max, s)
    }
    return Math.max(max, p.height ?? 0)
  }, 0)
  return { text, y, size }
}

const TITLE_NOISE = /^(published as a|formatting instructions|instructions for authors|this (is an? )?(open access|article)|\d{4}\s*(©|\(c\))|copyright\b|vol\.?\b|article\b|contents\b|journal homepage\b)/i
const TITLE_NOISE_ANYWHERE = /\b(formatting instructions|instructions for authors|published as a conference paper)\b/i
const ARXIV_HEADER = /^arxiv:\s*\d/i
const CITED_BY_HEADER = /^cited by\b/i
const JOURNAL_HEADER_NOISE = /^(contents lists available|journal homepage|www\.|http|sciencedirect|elsevier|springer)\b/i

function isNoiseTitleLine(text: string): boolean {
  if (TITLE_NOISE.test(text)) return true
  if (TITLE_NOISE_ANYWHERE.test(text)) return true
  if (ARXIV_HEADER.test(text)) return true
  if (CITED_BY_HEADER.test(text)) return true
  if (JOURNAL_HEADER_NOISE.test(text)) return true
  if (/\b(abstract|introduction|acknowledg|references|bibliography)\b/i.test(text)) return true
  return false
}

export function extractTitleCandidate(lines: LineInfo[]): string | null {
  if (lines.length === 0) return null
  const candidates = lines.filter((l) => l.text.length > 0 && l.size > 0)
  if (candidates.length === 0) return null

  const validForMax = candidates.filter((l) => !isNoiseTitleLine(l.text))
  if (validForMax.length === 0) return null

  const sortedBySize = [...validForMax].sort((a, b) => b.size - a.size)
  const maxSize = sortedBySize[0].size
  const titleThreshold = Math.max(maxSize * 0.85, 11)

  let titleSizeGroup = validForMax
    .filter((l) => l.size >= titleThreshold)
    .sort((a, b) => b.y - a.y)

  titleSizeGroup = filterJournalHeaderCluster(candidates, titleSizeGroup)

  const chosen = titleSizeGroup.length > 0 ? [titleSizeGroup[0]] : []

  if (chosen.length === 0) return null

  const start = chosen[0]
  const remainingByPosition = titleSizeGroup.filter((l) => l.y < start.y - 1)
  for (const l of remainingByPosition) {
    const gap = Math.abs(start.y - l.y)
    const nextGap = chosen.length > 0 ? Math.abs(chosen[chosen.length - 1].y - l.y) : 0
    if (gap > 40 || nextGap > 40) break
    chosen.push(l)
  }
  chosen.sort((a, b) => b.y - a.y)

  const titleText = chosen.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim()
  return titleText.length >= 8 ? titleText : null
}

function filterJournalHeaderCluster(allLines: LineInfo[], group: LineInfo[]): LineInfo[] {
  if (group.length <= 1) return group
  const PROX = 32
  const filtered = group.filter((line) => {
    const above = allLines.some((l) => l.y > line.y + 1 && l.y < line.y + PROX && JOURNAL_HEADER_NOISE.test(l.text))
    const below = allLines.some((l) => l.y < line.y - 1 && l.y > line.y - PROX && JOURNAL_HEADER_NOISE.test(l.text))
    return !(above && below)
  })
  return filtered.length > 0 ? filtered : group
}

async function parsePdf(filePath: string, maxPages: number): Promise<{ info: Record<string, unknown>; text: string; titleCandidate: string | null }> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')

  const pdfRoot = dirname(dirname(dirname(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'))))
  const standardFontDataUrl = join(pdfRoot, 'standard_fonts') + '/'
  const cMapUrl = join(pdfRoot, 'cmaps') + '/'

  const data = new Uint8Array(readFileSync(filePath))

  const loadingTask = pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableAutoFetch: true,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return loadingTask.promise.then(async (pdfDoc: any) => {
    let info: Record<string, unknown> = {}
    try {
      const meta = await pdfDoc.getMetadata()
      if (meta?.info) info = meta.info as Record<string, unknown>
    } catch {
      info = {}
    }

    const pageCount = Math.min(maxPages, pdfDoc.numPages)
    const textParts: string[] = []
    let titleCandidate: string | null = null

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await pdfDoc.getPage(i)
        const content = await page.getTextContent()
        const items = content.items as TextItem[]
        const lines = buildLines(items)
        textParts.push(lines.map((l) => l.text).join('\n'))
        if (i === 1 && titleCandidate === null) {
          titleCandidate = extractTitleCandidate(lines)
        }
      } catch {
        textParts.push('')
      }
    }

    return { info, text: textParts.join('\n'), titleCandidate }
  })
}

function isPdf(path: string): boolean {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return false
    return path.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

if (parentPort) {
  parentPort.on('message', async (event: { data: WorkerRequest }) => {
    const msg = event.data
    const { correlationId, filePath, maxPages = 5 } = msg

    if (!isPdf(filePath)) {
      parentPort!.postMessage({
        correlationId,
        error: { type: 'other' as const, message: `Not a PDF file: ${filePath}` }
      } satisfies WorkerResponse)
      return
    }

    const fileHash = await streamHash(filePath)

    try {
      const { info, text, titleCandidate } = await parsePdf(filePath, maxPages)
      parentPort!.postMessage({
        correlationId,
        fileHash,
        info,
        text,
        titleCandidate
      } satisfies WorkerResponse)
    } catch (e) {
      const name = (e as { name?: string; message?: string }).name ?? ''
      const message = (e as { message?: string }).message ?? String(e)

      if (name === 'PasswordException' || message.toLowerCase().includes('password')) {
        parentPort!.postMessage({
          correlationId,
          fileHash,
          error: { type: 'encrypted', message }
        } satisfies WorkerResponse)
      } else if (name === 'InvalidPDFException' || name === 'UnknownErrorException') {
        parentPort!.postMessage({
          correlationId,
          fileHash,
          error: { type: 'corrupted', message }
        } satisfies WorkerResponse)
      } else {
        parentPort!.postMessage({
          correlationId,
          fileHash,
          error: { type: 'other', message }
        } satisfies WorkerResponse)
      }
    }
  })
}
