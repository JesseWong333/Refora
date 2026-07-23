import type {
  ArxivSearchInput,
  ArxivSearchPaper,
  ArxivSearchResult
} from '../../shared/academicResearch'
import type { AcademicCache } from './academicCache'
import { normalizeArxivId, parseArxivFeed } from './arxiv'
import { waitForArxivRateLimit } from './arxivRateLimit'

export type AcademicFetch = (url: string, init?: RequestInit) => Promise<Response>

const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000
const MAX_ATOM_BYTES = 5 * 1024 * 1024
const MAX_HTML_BYTES = 20 * 1024 * 1024

export class ArxivClientError extends Error {
  constructor(
    readonly code:
      | 'invalid_arxiv_id'
      | 'arxiv_unreachable'
      | 'arxiv_rate_limited'
      | 'arxiv_html_unavailable'
      | 'invalid_arxiv_response',
    message: string
  ) {
    super(message)
    this.name = 'ArxivClientError'
  }
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const length = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ArxivClientError('invalid_arxiv_response', 'arXiv response is too large')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw new ArxivClientError('invalid_arxiv_response', 'arXiv response is too large')
  }
  return new TextDecoder().decode(bytes)
}

function encodeCursor(start: number): string {
  return Buffer.from(JSON.stringify({ start }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      start?: unknown
    }
    return typeof parsed.start === 'number' && Number.isInteger(parsed.start) && parsed.start >= 0
      ? parsed.start
      : 0
  } catch {
    return 0
  }
}

function escapeSearchTerm(value: string): string {
  return value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

function entryToSearchPaper(entry: ReturnType<typeof parseArxivFeed>['entries'][number]): ArxivSearchPaper {
  const id = entry.arxivId
  return {
    arxivId: id,
    title: entry.title,
    authors: entry.authors?.split(';').map((author) => author.trim()).filter(Boolean) ?? [],
    abstract: entry.abstract ?? undefined,
    publishedAt: entry.published ?? undefined,
    updatedAt: entry.updated ?? undefined,
    categories: entry.categories,
    doi: entry.doi ?? undefined,
    absUrl: `https://arxiv.org/abs/${id}`,
    htmlUrl: `https://arxiv.org/html/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`
  }
}

export function createArxivClient(fetchFn: AcademicFetch, cache: AcademicCache) {
  async function search(
    input: ArxivSearchInput,
    signal?: AbortSignal
  ): Promise<ArxivSearchResult> {
    const query = escapeSearchTerm(input.query)
    if (!query) throw new ArxivClientError('invalid_arxiv_response', 'Search query is empty')
    const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 20))
    const start = decodeCursor(input.cursor)
    const requestedCategories = (input.categories ?? [])
      .map((category) => category.trim())
      .filter(Boolean)
    const invalidCategory = requestedCategories.find(
      (category) => !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?$/i.test(category)
    )
    if (invalidCategory) {
      throw new ArxivClientError(
        'invalid_arxiv_response',
        `Invalid arXiv category: ${invalidCategory}`
      )
    }
    const categories = [...new Set(requestedCategories)].slice(0, 5)
    const queryParts = [`all:"${query}"`]
    if (categories.length > 0) {
      queryParts.push(`(${categories.map((category) => `cat:${category}`).join(' OR ')})`)
    }
    const params = new URLSearchParams({
      search_query: queryParts.join(' AND '),
      start: String(start),
      max_results: String(pageSize),
      sortBy: input.sort === 'submitted_date' ? 'submittedDate' : 'relevance',
      sortOrder: 'descending'
    })
    const url = `https://export.arxiv.org/api/query?${params.toString()}`
    const cacheKey = url
    const cached = await cache.getJson<Omit<ArxivSearchResult, 'cached'>>('arxiv-search', cacheKey)
    if (cached) return { ...cached.value, cached: true }

    await waitForArxivRateLimit()
    let response: Response
    try {
      response = await fetchFn(url, {
        signal: combinedSignal(signal, 15_000),
        headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' }
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ArxivClientError(
        'arxiv_unreachable',
        error instanceof Error ? error.message : String(error)
      )
    }
    if (response.status === 429) {
      throw new ArxivClientError('arxiv_rate_limited', 'arXiv rate limit reached')
    }
    if (!response.ok) {
      throw new ArxivClientError('arxiv_unreachable', `arXiv returned HTTP ${response.status}`)
    }

    const feed = parseArxivFeed(await readBoundedText(response, MAX_ATOM_BYTES))
    const nextStart = start + feed.entries.length
    const value: Omit<ArxivSearchResult, 'cached'> = {
      papers: feed.entries.map(entryToSearchPaper),
      total: feed.total,
      nextCursor: nextStart < feed.total ? encodeCursor(nextStart) : undefined,
      fetchedAt: new Date().toISOString()
    }
    await cache.setJson('arxiv-search', cacheKey, value, SEARCH_CACHE_TTL_MS)
    return { ...value, cached: false }
  }

  async function fetchHtml(
    input: string,
    signal?: AbortSignal
  ): Promise<{ arxivId: string; sourceUrl: string; html: string }> {
    const arxivId = normalizeArxivId(input)
    if (!arxivId) throw new ArxivClientError('invalid_arxiv_id', 'Invalid arXiv ID')
    const url = `https://arxiv.org/html/${arxivId}`
    await waitForArxivRateLimit()
    let response: Response
    try {
      response = await fetchFn(url, {
        signal: combinedSignal(signal, 30_000),
        headers: { 'User-Agent': 'Refora/0.1 (mailto:support@refora.app)' },
        redirect: 'follow'
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new ArxivClientError(
        'arxiv_unreachable',
        error instanceof Error ? error.message : String(error)
      )
    }
    if (response.status === 404) {
      throw new ArxivClientError(
        'arxiv_html_unavailable',
        'Official arXiv HTML is unavailable'
      )
    }
    if (!response.ok) {
      throw new ArxivClientError('arxiv_unreachable', `arXiv returned HTTP ${response.status}`)
    }
    const finalUrl = new URL(response.url || url)
    if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'arxiv.org') {
      throw new ArxivClientError('invalid_arxiv_response', 'Unexpected arXiv redirect')
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/html')) {
      throw new ArxivClientError('invalid_arxiv_response', 'arXiv did not return HTML')
    }
    return {
      arxivId,
      sourceUrl: finalUrl.toString(),
      html: await readBoundedText(response, MAX_HTML_BYTES)
    }
  }

  return { search, fetchHtml }
}

export type ArxivClient = ReturnType<typeof createArxivClient>
