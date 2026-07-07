import { createReadStream, readFileSync, statSync } from 'node:fs'
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

async function parsePdf(filePath: string, maxPages: number): Promise<{ info: Record<string, unknown>; text: string }> {
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

    for (let i = 1; i <= pageCount; i++) {
      try {
        const page = await pdfDoc.getPage(i)
        const content = await page.getTextContent()
        const items = content.items as Array<{ str: string; transform?: number[] }>
        const lines: string[] = []
        let currentLine: string[] = []
        let lastY: number | null = null
        for (const item of items) {
          const y = item.transform ? item.transform[5] : null
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
            lines.push(currentLine.join(' '))
            currentLine = []
          }
          currentLine.push(item.str)
          lastY = y
        }
        if (currentLine.length > 0) lines.push(currentLine.join(' '))
        textParts.push(lines.join('\n'))
      } catch {
        textParts.push('')
      }
    }

    return { info, text: textParts.join('\n') }
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
      const { info, text } = await parsePdf(filePath, maxPages)
      parentPort!.postMessage({
        correlationId,
        fileHash,
        info,
        text
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
