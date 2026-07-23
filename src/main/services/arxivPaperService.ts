import { mkdir, readFile } from 'node:fs/promises'
import type { ArxivPaperResult } from '../../shared/academicResearch'
import type { AcademicCache } from './academicCache'
import { normalizeArxivId } from './arxiv'
import type { ArxivClient } from './arxivClient'
import { ArxivClientError } from './arxivClient'
import { convertArxivHtmlToMarkdown } from './arxivHtmlToMarkdown'

interface ArxivManifest {
  schemaVersion: 1
  arxivId: string
  sourceUrl: string
  title?: string
  fetchedAt: number
  sections: ArxivPaperResult['sections']
  conversionWarnings: string[]
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    return typeof parsed.offset === 'number' && Number.isInteger(parsed.offset) && parsed.offset >= 0
      ? parsed.offset
      : 0
  } catch {
    return 0
  }
}

function pageEnd(text: string, start: number, maxChars: number): number {
  const hardEnd = Math.min(text.length, start + maxChars)
  if (hardEnd === text.length) return hardEnd
  const minimum = start + Math.floor(maxChars * 0.6)
  const paragraph = text.lastIndexOf('\n\n', hardEnd)
  if (paragraph >= minimum) return paragraph
  const line = text.lastIndexOf('\n', hardEnd)
  return line >= minimum ? line : hardEnd
}

export function createArxivPaperService(arxivClient: ArxivClient, cache: AcademicCache) {
  async function loadCached(arxivId: string): Promise<{
    manifest: ArxivManifest
    markdown: string
  } | null> {
    try {
      const manifest = JSON.parse(
        await readFile(cache.path('arxiv', arxivId, 'manifest.json'), 'utf8')
      ) as ArxivManifest
      if (manifest.schemaVersion !== 1 || manifest.arxivId !== arxivId) return null
      const versioned = /v\d+$/i.test(arxivId)
      if (!versioned && Date.now() - manifest.fetchedAt > 24 * 60 * 60 * 1000) return null
      const markdown = await readFile(cache.path('arxiv', arxivId, 'document.md'), 'utf8')
      if (!markdown) return null
      return { manifest, markdown }
    } catch {
      return null
    }
  }

  async function publish(
    arxivId: string,
    sourceUrl: string,
    converted: ReturnType<typeof convertArxivHtmlToMarkdown>
  ): Promise<ArxivManifest> {
    const directory = cache.path('arxiv', arxivId)
    await mkdir(directory, { recursive: true })
    const blocks: string[] = []
    let offset = 0
    for (const paragraph of converted.markdown.split(/\n{2,}/)) {
      const start = converted.markdown.indexOf(paragraph, offset)
      const end = start + paragraph.length
      blocks.push(JSON.stringify({ start, end, text: paragraph }))
      offset = end
    }
    const manifest: ArxivManifest = {
      schemaVersion: 1,
      arxivId,
      sourceUrl,
      title: converted.title,
      fetchedAt: Date.now(),
      sections: converted.sections,
      conversionWarnings: converted.warnings
    }
    await cache.writeText(cache.path('arxiv', arxivId, 'document.md'), converted.markdown)
    await cache.writeText(cache.path('arxiv', arxivId, 'blocks.jsonl'), blocks.join('\n'))
    await cache.writeText(
      cache.path('arxiv', arxivId, 'manifest.json'),
      JSON.stringify(manifest)
    )
    return manifest
  }

  async function getPaper(
    input: {
      arxivId: string
      sectionId?: string
      cursor?: string
      maxChars?: number
    },
    signal?: AbortSignal
  ): Promise<ArxivPaperResult> {
    const arxivId = normalizeArxivId(input.arxivId)
    if (!arxivId) throw new ArxivClientError('invalid_arxiv_id', 'Invalid arXiv ID')

    let cached = await loadCached(arxivId)
    const wasCached = cached !== null
    if (!cached) {
      const fetched = await arxivClient.fetchHtml(arxivId, signal)
      const converted = convertArxivHtmlToMarkdown(fetched.html, fetched.sourceUrl)
      const manifest = await publish(arxivId, fetched.sourceUrl, converted)
      cached = { manifest, markdown: converted.markdown }
    }

    const section = input.sectionId
      ? cached.manifest.sections.find((candidate) => candidate.id === input.sectionId)
      : undefined
    if (input.sectionId && !section) {
      throw new ArxivClientError('invalid_arxiv_response', 'Requested section was not found')
    }
    const sourceText = section
      ? cached.markdown.slice(section.start, section.end)
      : cached.markdown
    const maxChars = Math.min(12_000, Math.max(500, input.maxChars ?? 8000))
    const cursor = Math.min(sourceText.length, decodeCursor(input.cursor))
    const end = pageEnd(sourceText, cursor, maxChars)
    const contentMd = sourceText.slice(cursor, end).trim()

    return {
      arxivId,
      sourceUrl: cached.manifest.sourceUrl,
      sourceFormat: 'arxiv-html',
      outputFormat: 'markdown',
      title: cached.manifest.title,
      sections: cached.manifest.sections,
      sectionId: section?.id,
      cursor,
      maxChars,
      totalChars: sourceText.length,
      nextCursor: end < sourceText.length ? encodeCursor(end) : undefined,
      contentMd,
      conversionWarnings: cached.manifest.conversionWarnings,
      cached: wasCached
    }
  }

  return { getPaper }
}

export type ArxivPaperService = ReturnType<typeof createArxivPaperService>
