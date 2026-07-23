import type {
  AcademicGraphCandidate,
  AcademicGraphPage,
  PaperIdentity,
  PaperLocator,
  SemanticRecommendationResult
} from '../../shared/academicResearch'
import type { AcademicCache } from './academicCache'
import type { AcademicFetch } from './arxivClient'
import { baseArxivId, normalizeArxivId } from './arxiv'

const API_BASE = 'https://api.semanticscholar.org/graph/v1'
const RECOMMENDATIONS_BASE = 'https://api.semanticscholar.org/recommendations/v1'
const PAPER_FIELDS = [
  'paperId',
  'corpusId',
  'externalIds',
  'url',
  'title',
  'abstract',
  'venue',
  'year',
  'publicationDate',
  'authors',
  'citationCount',
  'referenceCount'
].join(',')
const GRAPH_FIELDS = [
  'contexts',
  'intents',
  'isInfluential',
  'paperId',
  'corpusId',
  'externalIds',
  'url',
  'title',
  'abstract',
  'venue',
  'year',
  'publicationDate',
  'authors',
  'citationCount',
  'referenceCount'
].join(',')
const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000
const GRAPH_TTL_MS = 24 * 60 * 60 * 1000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

interface SemanticScholarPaper {
  paperId?: string
  corpusId?: number
  externalIds?: Record<string, string | number | null>
  title?: string
  abstract?: string | null
  venue?: string | null
  year?: number | null
  publicationDate?: string | null
  authors?: Array<{ authorId?: string | null; name?: string }>
  citationCount?: number
  referenceCount?: number
}

interface SemanticScholarEdge {
  contexts?: string[]
  intents?: string[]
  isInfluential?: boolean
  citingPaper?: SemanticScholarPaper | null
  citedPaper?: SemanticScholarPaper | null
}

interface SemanticScholarGraphResponse {
  offset?: number
  next?: number
  total?: number
  data?: SemanticScholarEdge[]
}

export class SemanticScholarError extends Error {
  constructor(
    readonly code:
      | 'invalid_paper_locator'
      | 'paper_not_found'
      | 'semantic_scholar_unreachable'
      | 'semantic_scholar_rate_limited'
      | 'invalid_semantic_scholar_response',
    message: string
  ) {
    super(message)
    this.name = 'SemanticScholarError'
  }
}

function normalizeDoi(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:\s*/i, '')
    .toLowerCase()
}

function locatorToProviderId(locator: PaperLocator): string {
  const value = locator.value.trim()
  if (!value) throw new SemanticScholarError('invalid_paper_locator', 'Paper identifier is empty')
  if (locator.type === 'arxiv_id') {
    const arxivId = normalizeArxivId(value)
    if (!arxivId) throw new SemanticScholarError('invalid_paper_locator', 'Invalid arXiv ID')
    return `ARXIV:${arxivId}`
  }
  if (locator.type === 'doi') {
    const doi = normalizeDoi(value)
    if (!doi) throw new SemanticScholarError('invalid_paper_locator', 'Invalid DOI')
    return `DOI:${doi}`
  }
  if (locator.type === 's2_paper_id') return value
  if (locator.type === 's2_corpus_id') {
    if (!/^\d+$/.test(value)) {
      throw new SemanticScholarError('invalid_paper_locator', 'Invalid Semantic Scholar CorpusId')
    }
    return `CorpusId:${value}`
  }
  throw new SemanticScholarError(
    'invalid_paper_locator',
    'Local document identifiers must be resolved before calling Semantic Scholar'
  )
}

function paperIdentity(
  paper: SemanticScholarPaper,
  locator?: PaperLocator
): PaperIdentity {
  const title = paper.title?.trim()
  const paperId = paper.paperId?.trim()
  if (!title || !paperId) {
    throw new SemanticScholarError(
      'invalid_semantic_scholar_response',
      'Semantic Scholar paper is missing an ID or title'
    )
  }
  const externalIds = paper.externalIds ?? {}
  const rawArxiv = typeof externalIds.ArXiv === 'string'
    ? externalIds.ArXiv
    : typeof externalIds.ARXIV === 'string'
      ? externalIds.ARXIV
      : undefined
  const normalizedArxiv = rawArxiv ? normalizeArxivId(rawArxiv) ?? undefined : undefined
  const doi = typeof externalIds.DOI === 'string'
    ? normalizeDoi(externalIds.DOI)
    : undefined
  const corpusId = typeof paper.corpusId === 'number'
    ? paper.corpusId
    : typeof externalIds.CorpusId === 'number'
      ? externalIds.CorpusId
      : undefined
  const canonicalId = normalizedArxiv
    ? `arxiv:${baseArxivId(normalizedArxiv).toLowerCase()}`
    : doi
      ? `doi:${doi}`
      : `s2:${paperId}`

  return {
    canonicalId,
    arxivId: normalizedArxiv,
    doi,
    semanticScholarPaperId: paperId,
    semanticScholarCorpusId: corpusId,
    title,
    authors: (paper.authors ?? [])
      .filter((author) => typeof author.name === 'string' && author.name.trim().length > 0)
      .map((author) => ({
        authorId: author.authorId ?? undefined,
        name: author.name!.trim()
      })),
    year: paper.year ?? undefined,
    publicationDate: paper.publicationDate ?? undefined,
    abstract: paper.abstract ?? undefined,
    venue: paper.venue ?? undefined,
    citationCount: paper.citationCount,
    referenceCount: paper.referenceCount,
    matchStatus: 'exact',
    evidence: [{
      provider: 'semantic_scholar',
      identifier: paperId,
      matchedBy: locator?.type ?? 'semantic_scholar_result'
    }]
  }
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

export function createSemanticScholarClient(
  fetchFn: AcademicFetch,
  cache: AcademicCache,
  apiKey?: string
) {
  let lastRequestAt = 0
  let gateTail: Promise<void> = Promise.resolve()

  async function rateGate(): Promise<void> {
    const turn = gateTail.then(async () => {
      const remaining = 1000 - (Date.now() - lastRequestAt)
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      lastRequestAt = Date.now()
    })
    gateTail = turn.catch(() => undefined)
    await turn
  }

  async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await rateGate()
      let response: Response
      try {
        response = await fetchFn(url, {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
            : AbortSignal.timeout(20_000),
          headers: {
            Accept: 'application/json',
            ...(apiKey ? { 'x-api-key': apiKey } : {})
          }
        })
      } catch (error) {
        if (signal?.aborted) throw error
        if (attempt < 2) continue
        throw new SemanticScholarError(
          'semantic_scholar_unreachable',
          error instanceof Error ? error.message : String(error)
        )
      }

      if (response.status === 404) {
        throw new SemanticScholarError('paper_not_found', 'Paper was not found in Semantic Scholar')
      }
      if (response.status === 429) {
        if (attempt < 2) {
          const retryAfter = Number.parseFloat(response.headers.get('retry-after') ?? '1')
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(10_000, Math.max(1000, retryAfter * 1000)))
          )
          continue
        }
        throw new SemanticScholarError(
          'semantic_scholar_rate_limited',
          'Semantic Scholar rate limit reached'
        )
      }
      if (!response.ok) {
        throw new SemanticScholarError(
          'semantic_scholar_unreachable',
          `Semantic Scholar returned HTTP ${response.status}`
        )
      }
      const length = Number.parseInt(response.headers.get('content-length') ?? '', 10)
      if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
        throw new SemanticScholarError(
          'invalid_semantic_scholar_response',
          'Semantic Scholar response is too large'
        )
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_RESPONSE_BYTES) {
        throw new SemanticScholarError(
          'invalid_semantic_scholar_response',
          'Semantic Scholar response is too large'
        )
      }
      try {
        return JSON.parse(new TextDecoder().decode(bytes)) as T
      } catch {
        throw new SemanticScholarError(
          'invalid_semantic_scholar_response',
          'Semantic Scholar returned invalid JSON'
        )
      }
    }
    throw new SemanticScholarError(
      'semantic_scholar_unreachable',
      'Semantic Scholar request failed'
    )
  }

  async function getPaper(locator: PaperLocator, signal?: AbortSignal): Promise<PaperIdentity> {
    const providerId = locatorToProviderId(locator)
    const cacheKey = providerId
    const cached = await cache.getJson<SemanticScholarPaper>('s2-paper', cacheKey)
    if (cached) return paperIdentity(cached.value, locator)
    const url = `${API_BASE}/paper/${encodeURIComponent(providerId)}?fields=${encodeURIComponent(PAPER_FIELDS)}`
    const paper = await requestJson<SemanticScholarPaper>(url, signal)
    await cache.setJson('s2-paper', cacheKey, paper, IDENTITY_TTL_MS)
    return paperIdentity(paper, locator)
  }

  async function graphPage(
    locator: PaperLocator,
    direction: 'incoming' | 'outgoing',
    cursor?: string,
    limit = 20,
    signal?: AbortSignal,
    filters?: { publishedAfter?: string }
  ): Promise<AcademicGraphPage> {
    const providerId = locatorToProviderId(locator)
    const offset = decodeCursor(cursor)
    const pageSize = Math.min(50, Math.max(1, limit))
    const relation = direction === 'incoming' ? 'citations' : 'references'
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(pageSize),
      fields: GRAPH_FIELDS
    })
    if (filters?.publishedAfter) {
      params.set('publicationDateOrYear', `${filters.publishedAfter}:`)
    }
    const url = `${API_BASE}/paper/${encodeURIComponent(providerId)}/${relation}?${params.toString()}`
    const cacheKey = url
    let response: SemanticScholarGraphResponse
    let cached = false
    const cacheHit = await cache.getJson<SemanticScholarGraphResponse>('s2-graph', cacheKey)
    if (cacheHit) {
      response = cacheHit.value
      cached = true
    } else {
      response = await requestJson<SemanticScholarGraphResponse>(url, signal)
      await cache.setJson('s2-graph', cacheKey, response, GRAPH_TTL_MS)
    }
    const seed = await getPaper(locator, signal)
    const items: AcademicGraphCandidate[] = []
    for (const edge of response.data ?? []) {
      const rawPaper = direction === 'incoming' ? edge.citingPaper : edge.citedPaper
      if (!rawPaper) continue
      try {
        items.push({
          paper: paperIdentity(rawPaper),
          citationEvidence: {
            contexts: (edge.contexts ?? []).slice(0, 5),
            intents: (edge.intents ?? []).slice(0, 10),
            isInfluential: edge.isInfluential === true
          }
        })
      } catch {
        continue
      }
    }
    const next = typeof response.next === 'number' ? response.next : undefined
    const total = typeof response.total === 'number' ? response.total : undefined
    const scanned = offset + items.length
    return {
      seed,
      direction,
      items,
      total,
      nextCursor: next !== undefined ? encodeCursor(next) : undefined,
      coverage: {
        scanned,
        total,
        complete: next === undefined || (total !== undefined && scanned >= total)
      },
      fetchedAt: new Date().toISOString(),
      cached
    }
  }

  async function recommendations(
    locator: PaperLocator,
    limit = 20,
    signal?: AbortSignal
  ): Promise<SemanticRecommendationResult> {
    const providerId = locatorToProviderId(locator)
    const pageSize = Math.min(50, Math.max(1, limit))
    const params = new URLSearchParams({
      from: 'recent',
      limit: String(pageSize),
      fields: PAPER_FIELDS
    })
    const url =
      `${RECOMMENDATIONS_BASE}/papers/forpaper/${encodeURIComponent(providerId)}?${params.toString()}`
    const cacheKey = url
    let response: { recommendedPapers?: SemanticScholarPaper[] }
    let cached = false
    const cacheHit = await cache.getJson<typeof response>('s2-recommendations', cacheKey)
    if (cacheHit) {
      response = cacheHit.value
      cached = true
    } else {
      response = await requestJson<typeof response>(url, signal)
      await cache.setJson('s2-recommendations', cacheKey, response, GRAPH_TTL_MS)
    }
    const seed = await getPaper(locator, signal)
    const items: PaperIdentity[] = []
    for (const paper of response.recommendedPapers ?? []) {
      try {
        items.push(paperIdentity(paper))
      } catch {
        continue
      }
    }
    return {
      seed,
      items,
      fetchedAt: new Date().toISOString(),
      cached
    }
  }

  return {
    getPaper,
    getCitingPapers: (
      locator: PaperLocator,
      cursor?: string,
      limit?: number,
      signal?: AbortSignal,
      filters?: { publishedAfter?: string }
    ) => graphPage(locator, 'incoming', cursor, limit, signal, filters),
    getReferencedPapers: (
      locator: PaperLocator,
      cursor?: string,
      limit?: number,
      signal?: AbortSignal,
      filters?: { publishedAfter?: string }
    ) => graphPage(locator, 'outgoing', cursor, limit, signal, filters),
    getRecommendations: recommendations
  }
}

export type SemanticScholarClient = ReturnType<typeof createSemanticScholarClient>
