import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AcademicGraphCandidate,
  ArxivSearchPaper,
  ArxivSearchResult,
  FrontierBranch,
  FrontierCandidateView,
  FrontierView,
  PaperIdentity,
  PaperLocator
} from '../../shared/academicResearch'
import type { ArxivClient } from './arxivClient'
import type { AcademicGraphService } from './academicGraphService'
import type { AcademicIdentityService } from './academicIdentityService'

interface FrontierNode {
  paper: PaperIdentity
  discoveredBy: string[]
  graphDistance: number
  citationContexts: string[]
  citationIntents: string[]
  isInfluential: boolean
}

interface MergeResult {
  node: FrontierNode | null
  inserted: boolean
  limitReached: boolean
}

interface ResumeRequest {
  type: 'citations' | 'arxiv_search'
  locator?: PaperLocator
  cursor: string
  query?: string
}

interface FrontierSession {
  id: string
  workspaceId: string
  threadId: string
  objective: string
  seed: PaperIdentity
  round: number
  expansionsUsed: number
  visitedIds: Set<string>
  nodes: Map<string, FrontierNode>
  resumes: Map<string, ResumeRequest>
  publishedAfter?: string
  strictArxivOnly: boolean
  createdAt: number
  expiresAt: number
}

interface StoredFrontierSession {
  version: 1
  id: string
  workspaceId: string
  threadId: string
  objective: string
  seed: PaperIdentity
  round: number
  expansionsUsed: number
  visitedIds: string[]
  nodes: Array<[string, FrontierNode]>
  resumes: Array<[string, ResumeRequest]>
  publishedAfter?: string
  strictArxivOnly: boolean
  createdAt: number
  expiresAt: number
}

export interface StartFrontierInput {
  workspaceId: string
  threadId: string
  seed: PaperLocator
  objective: string
  branches?: FrontierBranch[]
  searchQueries?: string[]
  publishedAfter?: string
  strictArxivOnly?: boolean
}

export interface ExpandFrontierInput {
  workspaceId: string
  threadId: string
  frontierId: string
  paperIds: string[]
}

export interface ContinueFrontierInput {
  workspaceId: string
  threadId: string
  frontierId: string
  resumeToken: string
}

const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 20
const MAX_NODES = 50
const MAX_EXPANSIONS = 2
const BRANCH_LIMIT = 15
const MAX_SESSION_BYTES = 20 * 1024 * 1024
const MAX_PERSISTED_SESSIONS = 200
const MAX_PERSISTED_BYTES = 512 * 1024 * 1024

interface FrontierSessionFile {
  id: string | null
  path: string
  size: number
  modifiedAt: number
  temporary: boolean
}

interface FrontierPruneOptions {
  maxBytes?: number
  maxSessions?: number
  protectedIds?: ReadonlySet<string>
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function validPaperIdentity(value: unknown): value is PaperIdentity {
  const record = recordValue(value)
  return !!record &&
    typeof record.canonicalId === 'string' &&
    typeof record.title === 'string' &&
    Array.isArray(record.authors) &&
    record.authors.every((author) => {
      const candidate = recordValue(author)
      return !!candidate && typeof candidate.name === 'string'
    })
}

function validFrontierNode(value: unknown): value is FrontierNode {
  const record = recordValue(value)
  return !!record &&
    validPaperIdentity(record.paper) &&
    Array.isArray(record.discoveredBy) &&
    record.discoveredBy.every((item) => typeof item === 'string') &&
    Number.isInteger(record.graphDistance) &&
    Array.isArray(record.citationContexts) &&
    record.citationContexts.every((item) => typeof item === 'string') &&
    Array.isArray(record.citationIntents) &&
    record.citationIntents.every((item) => typeof item === 'string') &&
    typeof record.isInfluential === 'boolean'
}

function validPaperLocator(value: unknown): value is PaperLocator {
  const record = recordValue(value)
  return !!record &&
    (
      record.type === 'document_id' ||
      record.type === 'arxiv_id' ||
      record.type === 'doi' ||
      record.type === 's2_paper_id' ||
      record.type === 's2_corpus_id'
    ) &&
    typeof record.value === 'string'
}

function validResumeRequest(value: unknown): value is ResumeRequest {
  const record = recordValue(value)
  if (!record || typeof record.cursor !== 'string') return false
  if (record.type === 'citations') return validPaperLocator(record.locator)
  return record.type === 'arxiv_search' && typeof record.query === 'string'
}

function storedSession(value: unknown): StoredFrontierSession | null {
  const record = recordValue(value)
  if (
    !record ||
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    typeof record.workspaceId !== 'string' ||
    typeof record.threadId !== 'string' ||
    typeof record.objective !== 'string' ||
    !validPaperIdentity(record.seed) ||
    typeof record.round !== 'number' ||
    !Number.isInteger(record.round) ||
    record.round < 0 ||
    record.round > MAX_EXPANSIONS ||
    typeof record.expansionsUsed !== 'number' ||
    !Number.isInteger(record.expansionsUsed) ||
    record.expansionsUsed < 0 ||
    record.expansionsUsed > MAX_EXPANSIONS ||
    !Array.isArray(record.visitedIds) ||
    record.visitedIds.length > MAX_NODES + MAX_EXPANSIONS * 3 + 1 ||
    !record.visitedIds.every((id) => typeof id === 'string') ||
    !Array.isArray(record.nodes) ||
    record.nodes.length > MAX_NODES ||
    !Array.isArray(record.resumes) ||
    record.resumes.length > 100 ||
    typeof record.strictArxivOnly !== 'boolean' ||
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.expiresAt) ||
    (record.publishedAfter !== undefined && typeof record.publishedAfter !== 'string')
  ) {
    return null
  }
  const nodes = record.nodes as unknown[]
  const resumes = record.resumes as unknown[]
  if (!nodes.every((entry) =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'string' &&
    validFrontierNode(entry[1])
  )) {
    return null
  }
  if (!resumes.every((entry) =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    typeof entry[0] === 'string' &&
    validResumeRequest(entry[1])
  )) {
    return null
  }
  return value as StoredFrontierSession
}

export function createResearchFrontierSessionStore(root: string) {
  function sessionPath(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Invalid frontier session ID')
    }
    return join(root, `${id}.json`)
  }

  async function save(session: FrontierSession): Promise<void> {
    const stored: StoredFrontierSession = {
      version: 1,
      id: session.id,
      workspaceId: session.workspaceId,
      threadId: session.threadId,
      objective: session.objective,
      seed: session.seed,
      round: session.round,
      expansionsUsed: session.expansionsUsed,
      visitedIds: [...session.visitedIds],
      nodes: [...session.nodes],
      resumes: [...session.resumes],
      publishedAfter: session.publishedAfter,
      strictArxivOnly: session.strictArxivOnly,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    }
    const content = JSON.stringify(stored)
    if (Buffer.byteLength(content, 'utf8') > MAX_SESSION_BYTES) {
      throw new Error('Frontier session is too large to persist')
    }
    await mkdir(root, { recursive: true, mode: 0o700 })
    const path = sessionPath(session.id)
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  async function load(id: string): Promise<FrontierSession | null> {
    try {
      const path = sessionPath(id)
      const details = await stat(path)
      if (details.size > MAX_SESSION_BYTES) return null
      const value = storedSession(JSON.parse(await readFile(path, 'utf8')))
      if (!value || value.id !== id) return null
      return {
        id: value.id,
        workspaceId: value.workspaceId,
        threadId: value.threadId,
        objective: value.objective,
        seed: value.seed,
        round: value.round,
        expansionsUsed: value.expansionsUsed,
        visitedIds: new Set(value.visitedIds),
        nodes: new Map(value.nodes),
        resumes: new Map(value.resumes),
        publishedAfter: value.publishedAfter,
        strictArxivOnly: value.strictArxivOnly,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt
      }
    } catch {
      return null
    }
  }

  async function files(): Promise<FrontierSessionFile[]> {
    try {
      const files: FrontierSessionFile[] = []
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const match =
          /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/i
            .exec(entry.name)
        const temporary =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i
            .test(entry.name)
        if (!match && !temporary) continue
        const path = join(root, entry.name)
        const details = await stat(path).catch(() => null)
        if (!details) continue
        files.push({
          id: match?.[1] ?? null,
          path,
          size: details.size,
          modifiedAt: details.mtimeMs,
          temporary
        })
      }
      return files
    } catch {
      return []
    }
  }

  async function deleteThread(threadId: string): Promise<void> {
    for (const file of await files()) {
      if (!file.id || file.temporary) continue
      const session = await load(file.id)
      if (session?.threadId === threadId) {
        await unlink(file.path).catch(() => undefined)
      }
    }
  }

  async function deleteSession(id: string): Promise<void> {
    await unlink(sessionPath(id)).catch(() => undefined)
  }

  async function prune(
    now = Date.now(),
    options?: FrontierPruneOptions
  ): Promise<{
      deletedFiles: number
      deletedBytes: number
      remainingFiles: number
      remainingBytes: number
    }> {
    const maxBytes = Math.max(0, options?.maxBytes ?? MAX_PERSISTED_BYTES)
    const maxSessions = Math.max(
      0,
      Math.floor(options?.maxSessions ?? MAX_PERSISTED_SESSIONS)
    )
    const protectedIds = options?.protectedIds ?? new Set<string>()
    const storedFiles = await files()
    const retained: FrontierSessionFile[] = []
    let deletedFiles = 0
    let deletedBytes = 0
    let remainingFiles = storedFiles.filter((file) => !file.temporary).length
    let remainingBytes = storedFiles.reduce((sum, file) => sum + file.size, 0)

    async function remove(file: FrontierSessionFile): Promise<boolean> {
      const deleted = await unlink(file.path).then(() => true).catch(() => false)
      if (!deleted) return false
      deletedFiles += 1
      deletedBytes += file.size
      remainingBytes -= file.size
      if (!file.temporary) remainingFiles -= 1
      return true
    }

    for (const file of storedFiles) {
      if (file.temporary) {
        await remove(file)
        continue
      }
      if (!file.id) continue
      const session = await load(file.id)
      if (!session || session.expiresAt <= now) {
        if (!await remove(file)) retained.push(file)
      } else {
        retained.push(file)
      }
    }

    const removable = retained
      .filter((file) => file.id && !protectedIds.has(file.id))
      .sort((left, right) => left.modifiedAt - right.modifiedAt)
    for (const file of removable) {
      if (remainingFiles <= maxSessions && remainingBytes <= maxBytes) break
      await remove(file)
    }

    return { deletedFiles, deletedBytes, remainingFiles, remainingBytes }
  }

  return { save, load, deleteSession, deleteThread, prune }
}

function publicationTimestamp(candidate: FrontierCandidateView): number {
  const value = candidate.publicationDate ?? (candidate.year ? `${candidate.year}-01-01` : '')
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function createResearchFrontierService(
  identityService: AcademicIdentityService,
  graphService: AcademicGraphService,
  arxivClient: ArxivClient,
  sessionRoot?: string
) {
  const sessions = new Map<string, FrontierSession>()
  const sessionOperations = new Map<string, Promise<void>>()
  const sessionStore = sessionRoot
    ? createResearchFrontierSessionStore(sessionRoot)
    : null
  const sessionStoreReady: Promise<void> = sessionStore
    ? sessionStore.prune().then(() => undefined).catch(() => undefined)
    : Promise.resolve()

  async function persistSession(session: FrontierSession): Promise<void> {
    if (!sessionStore) return
    await sessionStoreReady
    await sessionStore.save(session)
    await sessionStore.prune(Date.now(), {
      protectedIds: new Set(sessions.keys())
    })
  }

  async function withSessionLock<T>(
    frontierId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = sessionOperations.get(frontierId) ?? Promise.resolve()
    let release = (): void => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    sessionOperations.set(frontierId, queued)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (sessionOperations.get(frontierId) === queued) {
        sessionOperations.delete(frontierId)
      }
    }
  }

  function cleanup(): void {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id)
    }
    while (sessions.size > MAX_SESSIONS) {
      const oldest = [...sessions.values()].sort((left, right) => left.createdAt - right.createdAt)[0]
      if (!oldest) break
      sessions.delete(oldest.id)
    }
  }

  async function sessionFor(
    frontierId: string,
    workspaceId: string,
    threadId: string
  ): Promise<FrontierSession> {
    cleanup()
    let session = sessions.get(frontierId)
    if (!session && sessionStore) {
      await sessionStoreReady
      session = await sessionStore.load(frontierId) ?? undefined
      if (session) sessions.set(frontierId, session)
    }
    if (
      !session ||
      session.workspaceId !== workspaceId ||
      session.threadId !== threadId ||
      session.expiresAt <= Date.now()
    ) {
      if (session?.expiresAt && session.expiresAt <= Date.now()) {
        sessions.delete(frontierId)
        await sessionStore?.deleteSession(frontierId)
      }
      throw new Error('Frontier session was not found or has expired')
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS
    return session
  }

  function passesFilters(session: FrontierSession, paper: PaperIdentity): boolean {
    if (session.strictArxivOnly && !paper.arxivId) return false
    if (!session.publishedAfter) return true
    const published = paper.publicationDate ?? (paper.year ? `${paper.year}-01-01` : '')
    return published.length > 0 && published >= session.publishedAfter
  }

  function mergeNode(
    session: FrontierSession,
    paper: PaperIdentity,
    discoveredBy: string,
    graphDistance: number,
    evidence?: AcademicGraphCandidate['citationEvidence']
  ): MergeResult {
    if (session.visitedIds.has(paper.canonicalId) || !passesFilters(session, paper)) {
      return { node: null, inserted: false, limitReached: false }
    }
    const existing = session.nodes.get(paper.canonicalId)
    if (existing) {
      if (!existing.discoveredBy.includes(discoveredBy)) existing.discoveredBy.push(discoveredBy)
      existing.graphDistance = Math.min(existing.graphDistance, graphDistance)
      existing.citationContexts = [
        ...new Set([...existing.citationContexts, ...(evidence?.contexts ?? [])])
      ].slice(0, 5)
      existing.citationIntents = [
        ...new Set([...existing.citationIntents, ...(evidence?.intents ?? [])])
      ].slice(0, 10)
      existing.isInfluential ||= evidence?.isInfluential === true
      return { node: existing, inserted: false, limitReached: false }
    }
    if (session.nodes.size >= MAX_NODES) {
      return { node: null, inserted: false, limitReached: true }
    }
    const node: FrontierNode = {
      paper,
      discoveredBy: [discoveredBy],
      graphDistance,
      citationContexts: (evidence?.contexts ?? []).slice(0, 5),
      citationIntents: (evidence?.intents ?? []).slice(0, 10),
      isInfluential: evidence?.isInfluential === true
    }
    session.nodes.set(paper.canonicalId, node)
    return { node, inserted: true, limitReached: false }
  }

  function views(session: FrontierSession, ids: string[]): FrontierCandidateView[] {
    return ids
      .map((id) => session.nodes.get(id))
      .filter((node): node is FrontierNode => node !== undefined)
      .map(view)
  }

  function hasExpandableNodes(session: FrontierSession): boolean {
    return [...session.nodes.keys()].some((id) => !session.visitedIds.has(id))
  }

  function arxivIdentity(paper: ArxivSearchPaper): PaperIdentity {
    return {
      canonicalId: `arxiv:${paper.arxivId.replace(/v\d+$/i, '').toLowerCase()}`,
      arxivId: paper.arxivId,
      doi: paper.doi,
      title: paper.title,
      authors: paper.authors.map((name) => ({ name })),
      year: paper.publishedAt ? Number.parseInt(paper.publishedAt.slice(0, 4), 10) : undefined,
      publicationDate: paper.publishedAt?.slice(0, 10),
      abstract: paper.abstract,
      matchStatus: 'exact',
      evidence: [{
        provider: 'arxiv',
        identifier: paper.arxivId,
        matchedBy: 'arxiv_search'
      }]
    }
  }

  function view(node: FrontierNode): FrontierCandidateView {
    const localDocumentId = identityService.localDocumentId(node.paper)
    const evidenceGaps: string[] = []
    if (!node.paper.abstract) evidenceGaps.push('abstract_unavailable')
    if (!node.paper.arxivId) evidenceGaps.push('arxiv_id_unavailable')
    if (!node.paper.publicationDate && !node.paper.year) {
      evidenceGaps.push('publication_date_unavailable')
    }
    return {
      canonicalId: node.paper.canonicalId,
      arxivId: node.paper.arxivId,
      doi: node.paper.doi,
      semanticScholarPaperId: node.paper.semanticScholarPaperId,
      title: node.paper.title,
      authors: node.paper.authors.map((author) => author.name),
      publicationDate: node.paper.publicationDate,
      year: node.paper.year,
      abstract: node.paper.abstract,
      discoveredBy: node.discoveredBy,
      citationContexts: node.citationContexts.length > 0 ? node.citationContexts : undefined,
      citationIntents: node.citationIntents.length > 0 ? node.citationIntents : undefined,
      isInfluential: node.isInfluential || undefined,
      graphDistance: node.graphDistance,
      inLocalLibrary: localDocumentId !== null,
      arxivHtmlAvailable: node.paper.arxivId ? null : false,
      evidenceGaps
    }
  }

  function resumeAction(
    session: FrontierSession,
    request: ResumeRequest,
    description: string
  ): FrontierView['nextActions'][number] {
    const token = randomUUID()
    session.resumes.set(token, request)
    return { type: 'continue', description, resumeToken: token }
  }

  function result(
    session: FrontierSession,
    expandedFrom: string[],
    groups: FrontierView['groups'],
    coverage: FrontierView['coverage'],
    nextActions: FrontierView['nextActions'],
    warnings: string[]
  ): FrontierView {
    return {
      frontierId: session.id,
      round: session.round,
      seed: session.seed,
      expandedFrom,
      groups,
      coverage,
      nextActions,
      warnings,
      fetchedAt: new Date().toISOString()
    }
  }

  async function start(
    input: StartFrontierInput,
    signal?: AbortSignal
  ): Promise<FrontierView> {
    cleanup()
    const seed = await identityService.resolve(input.seed, signal)
    const now = Date.now()
    const session: FrontierSession = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      objective: input.objective.trim(),
      seed,
      round: 0,
      expansionsUsed: 0,
      visitedIds: new Set([seed.canonicalId]),
      nodes: new Map(),
      resumes: new Map(),
      publishedAfter: input.publishedAfter,
      strictArxivOnly: input.strictArxivOnly === true,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    }
    sessions.set(session.id, session)
    cleanup()

    const branches = input.branches?.length
      ? [...new Set(input.branches)]
      : ['citations', 'recommendations', 'arxiv_recent'] satisfies FrontierBranch[]
    const citingPaperIds: string[] = []
    const recommendationIds: string[] = []
    const recentArxivPaperIds: string[] = []
    const coverage: FrontierView['coverage'] = {}
    const nextActions: FrontierView['nextActions'] = []
    const warnings: string[] = []
    let nodeLimitReached = false

    const queries = branches.includes('arxiv_recent')
      ? (input.searchQueries ?? [])
          .map((query) => query.trim())
          .filter(Boolean)
          .slice(0, 3)
      : []
    if (branches.includes('arxiv_recent') && queries.length === 0) {
      queries.push(session.objective || seed.title)
    }
    const [citationFetch, recommendationFetch, arxivFetches] = await Promise.all([
      branches.includes('citations')
        ? graphService
            .getCitingPapers(
              input.seed,
              undefined,
              BRANCH_LIMIT,
              signal,
              { publishedAfter: session.publishedAfter }
            )
            .then((page) => ({ page }))
            .catch((error: unknown) => ({ error }))
        : Promise.resolve(undefined),
      branches.includes('recommendations')
        ? graphService
            .getRecommendations(input.seed, BRANCH_LIMIT, signal)
            .then((page) => ({ page }))
            .catch((error: unknown) => ({ error }))
        : Promise.resolve(undefined),
      Promise.all(queries.map(async (
        query
      ): Promise<
        { query: string; page: ArxivSearchResult } |
        { query: string; error: unknown }
      > => {
        try {
          const page = await arxivClient.search({
            query,
            pageSize: BRANCH_LIMIT,
            sort: 'submitted_date'
          }, signal)
          return { query, page }
        } catch (error) {
          return { query, error }
        }
      }))
    ])

    if (citationFetch && 'page' in citationFetch) {
      const page = citationFetch.page
      for (const candidate of page.items) {
        const merged = mergeNode(
          session,
          candidate.paper,
          `citation:${seed.canonicalId}`,
          1,
          candidate.citationEvidence
        )
        nodeLimitReached ||= merged.limitReached
        if (merged.inserted && merged.node) citingPaperIds.push(merged.node.paper.canonicalId)
      }
      coverage.citations = page.coverage
      if (page.nextCursor) {
        nextActions.push(resumeAction(session, {
          type: 'citations',
          locator: input.seed,
          cursor: page.nextCursor
        }, 'Continue scanning papers that cite the seed paper'))
      }
    } else if (citationFetch && 'error' in citationFetch) {
      warnings.push(`citations: ${citationFetch.error instanceof Error
        ? citationFetch.error.message
        : String(citationFetch.error)}`)
    }

    if (recommendationFetch && 'page' in recommendationFetch) {
      const page = recommendationFetch.page
      for (const paper of page.items) {
        const merged = mergeNode(
          session,
          paper,
          `recommendation:${seed.canonicalId}`,
          1
        )
        nodeLimitReached ||= merged.limitReached
        if (merged.inserted && merged.node) recommendationIds.push(merged.node.paper.canonicalId)
      }
      coverage.recommendations = {
        scanned: page.items.length,
        total: page.items.length,
        complete: true
      }
    } else if (recommendationFetch && 'error' in recommendationFetch) {
      warnings.push(`recommendations: ${recommendationFetch.error instanceof Error
        ? recommendationFetch.error.message
        : String(recommendationFetch.error)}`)
    }

    for (const fetchResult of arxivFetches) {
      if ('page' in fetchResult) {
        const { page, query } = fetchResult
        for (const paper of page.papers) {
          const merged = mergeNode(
            session,
            arxivIdentity(paper),
            `arxiv_search:${query}`,
            1
          )
          nodeLimitReached ||= merged.limitReached
          if (merged.inserted && merged.node) {
            recentArxivPaperIds.push(merged.node.paper.canonicalId)
          }
        }
        const existing = coverage.arxivSearch
        coverage.arxivSearch = {
          scanned: (existing?.scanned ?? 0) + page.papers.length,
          total: (existing?.total ?? 0) + page.total,
          complete: !page.nextCursor && (existing?.complete ?? true),
          description: page.nextCursor
            ? 'Recent arXiv results are paginated and not fully scanned.'
            : existing?.description
        }
        if (page.nextCursor) {
          nextActions.push(resumeAction(session, {
            type: 'arxiv_search',
            cursor: page.nextCursor,
            query
          }, `Continue recent arXiv search for "${query}"`))
        }
      } else {
        warnings.push(`arxiv_recent "${fetchResult.query}": ${fetchResult.error instanceof Error
          ? fetchResult.error.message
          : String(fetchResult.error)}`)
      }
    }

    const citingPapers = views(session, citingPaperIds)
    const recommendations = views(session, recommendationIds)
    const recentArxivPapers = views(session, recentArxivPaperIds)
    citingPapers.sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left))
    recentArxivPapers.sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left))
    if (nodeLimitReached) {
      warnings.push(`candidate_limit_reached: retained the first ${MAX_NODES} unique candidates in deterministic branch order`)
    }
    if (hasExpandableNodes(session)) {
      nextActions.unshift({
        type: 'expand',
        description: 'Select up to three candidate paper IDs for the next exploration round'
      })
    }
    const output = result(
      session,
      [seed.canonicalId],
      { citingPapers, recommendations, recentArxivPapers },
      coverage,
      nextActions,
      warnings
    )
    await persistSession(session)
    return output
  }

  async function expandUnlocked(
    input: ExpandFrontierInput,
    signal?: AbortSignal
  ): Promise<FrontierView> {
    const session = await sessionFor(input.frontierId, input.workspaceId, input.threadId)
    if (session.expansionsUsed >= MAX_EXPANSIONS) {
      throw new Error('Frontier expansion limit reached')
    }
    const selected = [...new Set(input.paperIds)].slice(0, 3)
      .map((id) => session.nodes.get(id))
      .filter(
        (node): node is FrontierNode =>
          node !== undefined && !session.visitedIds.has(node.paper.canonicalId)
      )
    if (selected.length === 0) throw new Error('No selected paper exists in this frontier session')

    session.round += 1
    session.expansionsUsed += 1
    const citingPaperIds: string[] = []
    const recommendationIds: string[] = []
    const coverage: FrontierView['coverage'] = {}
    const nextActions: FrontierView['nextActions'] = []
    const warnings: string[] = []
    let nodeLimitReached = false

    const fetched = await Promise.all(selected.map(async (node) => {
      session.visitedIds.add(node.paper.canonicalId)
      let locator: PaperLocator
      try {
        locator = identityService.toSemanticScholarLocator(node.paper)
      } catch (error) {
        return { node, error }
      }
      const [citations, related] = await Promise.allSettled([
        graphService.getCitingPapers(
          locator,
          undefined,
          10,
          signal,
          { publishedAfter: session.publishedAfter }
        ),
        graphService.getRecommendations(locator, 10, signal)
      ])
      return { node, locator, citations, related }
    }))

    for (const fetchResult of fetched) {
      if ('error' in fetchResult) {
        warnings.push(`${fetchResult.node.paper.title}: ${fetchResult.error instanceof Error
          ? fetchResult.error.message
          : String(fetchResult.error)}`)
        continue
      }
      const { node, locator, citations, related } = fetchResult
      if (citations.status === 'fulfilled') {
        for (const candidate of citations.value.items) {
          const merged = mergeNode(
            session,
            candidate.paper,
            `citation:${node.paper.canonicalId}`,
            node.graphDistance + 1,
            candidate.citationEvidence
          )
          nodeLimitReached ||= merged.limitReached
          if (merged.inserted && merged.node) citingPaperIds.push(merged.node.paper.canonicalId)
        }
        const existing = coverage.citations
        coverage.citations = {
          scanned: (existing?.scanned ?? 0) + citations.value.coverage.scanned,
          total: existing?.total !== undefined && citations.value.coverage.total !== undefined
            ? existing.total + citations.value.coverage.total
            : undefined,
          complete: (existing?.complete ?? true) && citations.value.coverage.complete
        }
        if (citations.value.nextCursor) {
          nextActions.push(resumeAction(session, {
            type: 'citations',
            locator,
            cursor: citations.value.nextCursor
          }, `Continue citations for "${node.paper.title}"`))
        }
      } else {
        warnings.push(`${node.paper.title} citations: ${citations.reason instanceof Error
          ? citations.reason.message
          : String(citations.reason)}`)
      }
      if (related.status === 'fulfilled') {
        for (const paper of related.value.items) {
          const merged = mergeNode(
            session,
            paper,
            `recommendation:${node.paper.canonicalId}`,
            node.graphDistance + 1
          )
          nodeLimitReached ||= merged.limitReached
          if (merged.inserted && merged.node) recommendationIds.push(merged.node.paper.canonicalId)
        }
        const existing = coverage.recommendations
        coverage.recommendations = {
          scanned: (existing?.scanned ?? 0) + related.value.items.length,
          total: (existing?.total ?? 0) + related.value.items.length,
          complete: true
        }
      } else {
        warnings.push(`${node.paper.title} recommendations: ${related.reason instanceof Error
          ? related.reason.message
          : String(related.reason)}`)
      }
    }

    const citingPapers = views(session, citingPaperIds)
    const recommendations = views(session, recommendationIds)
    citingPapers.sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left))
    if (nodeLimitReached) {
      warnings.push(`candidate_limit_reached: retained the first ${MAX_NODES} unique candidates in deterministic expansion order`)
    }
    if (session.expansionsUsed < MAX_EXPANSIONS && hasExpandableNodes(session)) {
      nextActions.unshift({
        type: 'expand',
        description: 'Select up to three candidate paper IDs for another exploration round'
      })
    }
    const output = result(
      session,
      selected.map((node) => node.paper.canonicalId),
      { citingPapers, recommendations, recentArxivPapers: [] },
      coverage,
      nextActions,
      warnings
    )
    await persistSession(session)
    return output
  }

  async function continuePageUnlocked(
    input: ContinueFrontierInput,
    signal?: AbortSignal
  ): Promise<FrontierView> {
    const session = await sessionFor(input.frontierId, input.workspaceId, input.threadId)
    const request = session.resumes.get(input.resumeToken)
    if (!request) throw new Error('Resume token was not found or has already been used')

    const citingPaperIds: string[] = []
    const recentArxivPaperIds: string[] = []
    const coverage: FrontierView['coverage'] = {}
    const nextActions: FrontierView['nextActions'] = []
    const warnings: string[] = []
    let nodeLimitReached = false

    if (request.type === 'citations' && request.locator) {
      const page = await graphService.getCitingPapers(
        request.locator,
        request.cursor,
        BRANCH_LIMIT,
        signal,
        { publishedAfter: session.publishedAfter }
      )
      for (const candidate of page.items) {
        const merged = mergeNode(
          session,
          candidate.paper,
          `citation:${page.seed.canonicalId}`,
          1,
          candidate.citationEvidence
        )
        nodeLimitReached ||= merged.limitReached
        if (merged.inserted && merged.node) citingPaperIds.push(merged.node.paper.canonicalId)
      }
      coverage.citations = page.coverage
      if (page.nextCursor) {
        nextActions.push(resumeAction(session, {
          ...request,
          cursor: page.nextCursor
        }, 'Continue scanning citation results'))
      }
    } else if (request.type === 'arxiv_search' && request.query) {
      const page = await arxivClient.search({
        query: request.query,
        cursor: request.cursor,
        pageSize: BRANCH_LIMIT,
        sort: 'submitted_date'
      }, signal)
      for (const paper of page.papers) {
        const merged = mergeNode(
          session,
          arxivIdentity(paper),
          `arxiv_search:${request.query}`,
          1
        )
        nodeLimitReached ||= merged.limitReached
        if (merged.inserted && merged.node) {
          recentArxivPaperIds.push(merged.node.paper.canonicalId)
        }
      }
      coverage.arxivSearch = {
        scanned: page.papers.length,
        total: page.total,
        complete: !page.nextCursor
      }
      if (page.nextCursor) {
        nextActions.push(resumeAction(session, {
          ...request,
          cursor: page.nextCursor
        }, `Continue recent arXiv search for "${request.query}"`))
      }
    }

    session.resumes.delete(input.resumeToken)
    const citingPapers = views(session, citingPaperIds)
    const recentArxivPapers = views(session, recentArxivPaperIds)
    citingPapers.sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left))
    recentArxivPapers.sort((left, right) => publicationTimestamp(right) - publicationTimestamp(left))
    if (nodeLimitReached) {
      warnings.push(`candidate_limit_reached: retained at most ${MAX_NODES} unique candidates`)
    }
    const output = result(
      session,
      [],
      { citingPapers, recommendations: [], recentArxivPapers },
      coverage,
      nextActions,
      warnings
    )
    await persistSession(session)
    return output
  }

  async function expand(
    input: ExpandFrontierInput,
    signal?: AbortSignal
  ): Promise<FrontierView> {
    return withSessionLock(input.frontierId, () => expandUnlocked(input, signal))
  }

  async function continuePage(
    input: ContinueFrontierInput,
    signal?: AbortSignal
  ): Promise<FrontierView> {
    return withSessionLock(input.frontierId, () => continuePageUnlocked(input, signal))
  }

  async function deleteThread(threadId: string): Promise<void> {
    for (const [id, session] of sessions) {
      if (session.threadId === threadId) sessions.delete(id)
    }
    await sessionStoreReady
    await sessionStore?.deleteThread(threadId)
  }

  return { start, expand, continuePage, deleteThread }
}

export type ResearchFrontierService = ReturnType<typeof createResearchFrontierService>
