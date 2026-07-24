import { type BrowserWindow } from 'electron'
import type { Repositories } from '../db/repositories'
import type {
  AiSummaryContent,
  ChatSendRequest,
  Document
} from '../../shared/ipc-types'
import type { PdfTextService } from './pdfText'
import type { AiSummaryService } from './aiSummary'
import type { MineruDocumentService } from './mineruDocumentService'
import type { WebSearchService } from './webSearch'
import type { AgentExecutionService } from './agentExecution'
import type { AgentArtifactPublisher } from './agentArtifactPublisher'
import type { AgentRuntimeManager } from './agentRuntimeManager'
import type { ArxivClient } from './arxivClient'
import type { ArxivPaperService } from './arxivPaperService'
import type { AcademicIdentityService } from './academicIdentityService'
import type { AcademicGraphService } from './academicGraphService'
import type { ResearchFrontierService } from './researchFrontierService'
import { normalizeArxivId } from './arxiv'
import { updateWorkspaceMemory } from './reforaWorkspaceMemoryBackend'
import { openPdf } from './pdfOpen'
import {
  emitAiReportCreated,
  emitWorkspaceItemsChanged
} from '../ipc/events'
import {
  createStringHostOperation,
  createStructuredHostOperation,
  type AgentHostOperation
} from './agentHostOperation'

const MAX_FULLTEXT_CHARS = 8000
const RELATED_PAPER_STOP_TERMS = new Set([
  'about',
  'after',
  'also',
  'among',
  'analysis',
  'based',
  'before',
  'between',
  'from',
  'into',
  'method',
  'methods',
  'paper',
  'results',
  'study',
  'that',
  'their',
  'these',
  'this',
  'through',
  'using',
  'with'
])

function normalizedTerms(value: string | null | undefined): Set<string> {
  const matches = value
    ?.normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
  return new Set(
    (matches ?? []).filter((term) => term.length >= 2 && !RELATED_PAPER_STOP_TERMS.has(term))
  )
}

function normalizedAuthors(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(/;|\band\b/iu)
      .map((author) => author.normalize('NFKC').toLocaleLowerCase().trim())
      .filter((author) => author.length > 0)
  )
}

function sharedValues(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => right.has(value)).sort()
}

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').toLocaleLowerCase().trim()
}

function parseSourceDocIds(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    parsed = undefined
  }
  if (Array.isArray(parsed)) {
    return parsed.filter((value): value is string => typeof value === 'string')
  }
  return trimmed
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export interface AiAgentAcademicResearchServices {
  arxivClient: ArxivClient
  arxivPaperService: ArxivPaperService
  identityService: AcademicIdentityService
  graphService: AcademicGraphService
  frontierService: ResearchFrontierService
}

export function createAgentHostOperations(input: {
  repos: Repositories
  getWin: () => BrowserWindow | null
  req: ChatSendRequest
  providerModel: string
  signal: AbortSignal
  pdfTextService: PdfTextService
  aiSummaryService: AiSummaryService
  agentExecutionService?: AgentExecutionService
  agentArtifactPublisher?: AgentArtifactPublisher
  agentRuntimeManager?: AgentRuntimeManager
  academicResearch?: AiAgentAcademicResearchServices
  mineruDocumentService?: MineruDocumentService
  webSearchService?: WebSearchService
}): AgentHostOperation[] {
  const {
    repos,
    getWin,
    req,
    providerModel,
    signal,
    pdfTextService,
    aiSummaryService,
    agentExecutionService,
    agentArtifactPublisher,
    agentRuntimeManager,
    academicResearch,
    mineruDocumentService,
    webSearchService
  } = input
  const workspaceId = req.workspaceId ?? ''
  const listWorkspaceContext = createStructuredHostOperation({
    name: 'list_workspace_context',
    func: async () => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const items = repos.workspaceItems.list(workspaceId)
      const reports = new Map(repos.aiReports.list(workspaceId).map((report) => [report.id, report]))
      const notes = new Map(repos.workspaceNotes.list(workspaceId).map((note) => [note.id, note]))
      const assets = new Map(repos.workspaceAssets.list(workspaceId).map((asset) => [asset.id, asset]))
      const contextItems = items.map((item) => {
        const base = {
          itemId: item.id,
          kind: item.kind,
          sortOrder: item.sortOrder
        }
        if (item.kind === 'document' && item.docId) {
          const doc = repos.documents.get(item.docId)
          return {
            ...base,
            docId: item.docId,
            title: doc?.title ?? doc?.fileName ?? item.docId,
            authors: doc?.authors ?? '',
            year: doc?.year ?? '',
            hasSummary: !!repos.aiSummaries.getSummary(item.docId)?.content,
            unavailable: !doc
          }
        }
        if (item.kind === 'report' && item.reportId) {
          const report = reports.get(item.reportId)
          return {
            ...base,
            reportId: item.reportId,
            title: report?.title ?? item.reportId,
            sourceDocIds: report?.sourceDocIds ?? [],
            unavailable: !report
          }
        }
        if (item.kind === 'note' && item.noteId) {
          const note = notes.get(item.noteId)
          return {
            ...base,
            noteId: item.noteId,
            title: note?.title ?? item.noteId,
            noteType: note?.noteType ?? null,
            unavailable: !note
          }
        }
        if (item.kind === 'asset' && item.assetId) {
          const asset = assets.get(item.assetId)
          return {
            ...base,
            assetId: item.assetId,
            fileName: asset?.fileName ?? item.assetId,
            mimeType: asset?.mimeType ?? null,
            previewKind: asset?.previewKind ?? null,
            fileMissing: asset?.fileMissing ?? 1,
            unavailable: !asset
          }
        }
        return { ...base, unavailable: true }
      })
      const connections = repos.workspaceConnections.list(workspaceId).map((connection) => ({
        connectionId: connection.id,
        sourceItemId: connection.sourceItemId,
        targetItemId: connection.targetItemId,
        sourceAnchor: connection.sourceAnchor,
        targetAnchor: connection.targetAnchor
      }))
      return JSON.stringify({
        workspaceId,
        itemCount: contextItems.length,
        connectionCount: connections.length,
        items: contextItems,
        connections
      })
    }
  })

  const createWorkspaceConnections = createStructuredHostOperation({
    name: 'create_workspace_connections',
    func: async ({
      connections
    }: {
      connections: Array<{
        sourceItemId: string
        targetItemId: string
        sourceAnchor: 'top' | 'right' | 'bottom' | 'left'
        targetAnchor: 'top' | 'right' | 'bottom' | 'left'
      }>
    }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const itemIds = new Set(repos.workspaceItems.list(workspaceId).map((item) => item.id))
      const existingPairs = new Set(
        repos.workspaceConnections
          .list(workspaceId)
          .map((connection) => `${connection.sourceItemId}\u0000${connection.targetItemId}`)
      )
      const requestedPairs = new Set<string>()
      const valid: typeof connections = []
      const errors: Array<{ sourceItemId: string; targetItemId: string; message: string }> = []

      for (const connection of connections) {
        const pair = `${connection.sourceItemId}\u0000${connection.targetItemId}`
        if (connection.sourceItemId === connection.targetItemId) {
          errors.push({
            sourceItemId: connection.sourceItemId,
            targetItemId: connection.targetItemId,
            message: 'A card cannot connect to itself.'
          })
          continue
        }
        if (!itemIds.has(connection.sourceItemId) || !itemIds.has(connection.targetItemId)) {
          errors.push({
            sourceItemId: connection.sourceItemId,
            targetItemId: connection.targetItemId,
            message: 'Connection endpoint is not in the current workspace.'
          })
          continue
        }
        if (existingPairs.has(pair) || requestedPairs.has(pair)) {
          errors.push({
            sourceItemId: connection.sourceItemId,
            targetItemId: connection.targetItemId,
            message: 'Connection already exists.'
          })
          continue
        }
        requestedPairs.add(pair)
        valid.push(connection)
      }

      const created = valid.length > 0
        ? repos.transaction(() =>
            valid.map((connection) =>
              repos.workspaceConnections.create(
                workspaceId,
                connection.sourceItemId,
                connection.targetItemId,
                connection.sourceAnchor,
                connection.targetAnchor
              )
            )
          )
        : []
      const w = getWin()
      if (created.length > 0 && w) {
        emitWorkspaceItemsChanged(w, { workspaceId, reason: 'other' })
      }
      return JSON.stringify({ created, errors })
    }
  })

  const findRelatedPapers = createStructuredHostOperation({
    name: 'find_related_papers',
    func: async ({ docId, limit }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const seedId = docId.trim()
      const seed = repos.documents.get(seedId)
      if (!seed) return JSON.stringify({ error: 'Document not found', docId: seedId })

      const seedTitle = normalizedTerms(seed.title ?? seed.fileName)
      const seedKeywords = normalizedTerms(seed.keywords)
      const seedAbstract = normalizedTerms(seed.abstract)
      const seedAuthors = normalizedAuthors(seed.authors)
      const seedVenue = normalizeComparable(seed.venue)
      const seedYear = Number.parseInt(seed.year ?? '', 10)
      const workspaceDocIds = workspaceId
        ? new Set(
            repos.workspaceItems
              .list(workspaceId)
              .filter((item) => item.kind === 'document' && item.docId)
              .map((item) => item.docId as string)
          )
        : new Set<string>()

      const related = repos.documents
        .list({ mode: 'all' })
        .filter((candidate) => candidate.id !== seedId)
        .map((candidate) => {
          const sharedKeywords = sharedValues(seedKeywords, normalizedTerms(candidate.keywords))
          const sharedTitleTerms = sharedValues(
            seedTitle,
            normalizedTerms(candidate.title ?? candidate.fileName)
          )
          const sharedAbstractTerms = sharedValues(
            seedAbstract,
            normalizedTerms(candidate.abstract)
          )
          const sharedAuthors = sharedValues(seedAuthors, normalizedAuthors(candidate.authors))
          const sameVenue = seedVenue.length > 0 && seedVenue === normalizeComparable(candidate.venue)
          const candidateYear = Number.parseInt(candidate.year ?? '', 10)
          const nearbyYear =
            Number.isFinite(seedYear) &&
            Number.isFinite(candidateYear) &&
            Math.abs(seedYear - candidateYear) <= 1
          const evidenceScore =
            sharedKeywords.length * 4 +
            sharedTitleTerms.length * 2 +
            Math.min(sharedAbstractTerms.length, 12) * 0.25 +
            sharedAuthors.length * 3 +
            (sameVenue ? 1 : 0)
          const score = evidenceScore > 0 ? evidenceScore + (nearbyYear ? 0.25 : 0) : 0
          return {
            docId: candidate.id,
            title: candidate.title ?? candidate.fileName,
            authors: candidate.authors ?? '',
            year: candidate.year ?? '',
            venue: candidate.venue ?? '',
            inWorkspace: workspaceDocIds.has(candidate.id),
            score: Math.round(score * 100) / 100,
            reasons: {
              sharedKeywords,
              sharedAuthors,
              sharedTitleTerms: sharedTitleTerms.slice(0, 8),
              sharedAbstractTerms: sharedAbstractTerms.slice(0, 8),
              sameVenue,
              nearbyYear
            }
          }
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
        .slice(0, limit)

      return JSON.stringify({ seedDocId: seedId, results: related })
    }
  })

  const searchWorkspaceDocs = createStringHostOperation({
    name: 'search_workspace_docs',
    argumentName: 'query',
    func: async (query: string): Promise<string> => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const items = repos.workspaceItems
        .list(workspaceId)
        .filter((i) => i.kind === 'document')
      const workspaceDocIds = new Set(
        items.map((i) => i.docId).filter((d): d is string => d !== null)
      )
      const q = query.trim()
      if (!q) {
        const docs: Document[] = []
        for (const id of workspaceDocIds) {
          const d = repos.documents.get(id)
          if (d) docs.push(d)
        }
        const result = docs.slice(0, 50).map((d) => ({
          docId: d.id,
          title: d.title ?? d.fileName,
          authors: d.authors ?? '',
          year: d.year ?? '',
          hasSummary: !!(repos.aiSummaries.getSummary(d.id)?.content)
        }))
        return JSON.stringify(result)
      }
      const hits = repos.documents.search(q)
      const filtered = hits.filter((d) => workspaceDocIds.has(d.id))
      const result = filtered.slice(0, 30).map((d) => ({
        docId: d.id,
        title: d.title ?? d.fileName,
        authors: d.authors ?? '',
        year: d.year ?? '',
        hasSummary: !!(repos.aiSummaries.getSummary(d.id)?.content)
      }))
      return JSON.stringify(result)
    }
  })

  const readPaperFulltext = createStructuredHostOperation({
    name: 'read_paper_fulltext',
    func: async ({ docId, offset, limit }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const id = docId.trim()
      const doc = repos.documents.get(id)
      if (!doc) {
        return JSON.stringify({ error: 'Document not found', docId: id })
      }
      let text: string
      try {
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        text = await pdfTextService.getOrExtract(id)
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      } catch {
        return JSON.stringify({ error: 'Failed to extract text', docId: id })
      }
      const clampedLimit = Math.min(12000, Math.max(500, limit ?? MAX_FULLTEXT_CHARS))
      const totalChars = text.length
      const startOffset = offset ?? 0
      if (startOffset >= totalChars) {
        return JSON.stringify({
          docId: id,
          title: doc.title ?? doc.fileName,
          offset: startOffset,
          limit: clampedLimit,
          totalChars,
          nextOffset: null,
          chunkIndex: Math.floor(startOffset / clampedLimit),
          chunkCount: Math.ceil(totalChars / clampedLimit),
          text: '',
          message: 'offset past end'
        })
      }
      const slicedText = text.slice(startOffset, startOffset + clampedLimit)
      const nextOffset =
        startOffset + slicedText.length < totalChars ? startOffset + slicedText.length : null
      return JSON.stringify({
        docId: id,
        title: doc.title ?? doc.fileName,
        offset: startOffset,
        limit: clampedLimit,
        totalChars,
        nextOffset,
        chunkIndex: Math.floor(startOffset / clampedLimit),
        chunkCount: Math.ceil(totalChars / clampedLimit),
        text: slicedText
      })
    }
  })

  const readPaperOcrFulltext = createStructuredHostOperation({
    name: 'read_paper_ocr_fulltext',
    func: async ({ docId, offset, limit }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const id = docId.trim()
      const doc = repos.documents.get(id)
      if (!doc) {
        return JSON.stringify({ error: 'Document not found', docId: id })
      }
      if (!mineruDocumentService) {
        return JSON.stringify({ error: 'OCR service is unavailable', docId: id })
      }
      try {
        const cached = await mineruDocumentService.readCachedForAgent(id)
        if (!cached) {
          return JSON.stringify({
            status: 'ocr_cache_missing',
            docId: id,
            nextTool: 'prepare_paper_ocr',
            approval: 'handled_by_application',
            instruction:
              'Call prepare_paper_ocr now. Do not ask for approval in assistant text; the application will show the approval UI.'
          })
        }
        const { result, markdown } = cached
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        const clampedLimit = Math.min(12000, Math.max(500, limit ?? MAX_FULLTEXT_CHARS))
        const totalChars = markdown.length
        const startOffset = offset ?? 0
        if (startOffset >= totalChars) {
          return JSON.stringify({
            docId: id,
            title: doc.title ?? doc.fileName,
            source: 'mineru_ocr',
            profile: result.profile,
            resultKey: result.resultKey,
            offset: startOffset,
            limit: clampedLimit,
            totalChars,
            nextOffset: null,
            chunkIndex: Math.floor(startOffset / clampedLimit),
            chunkCount: Math.ceil(totalChars / clampedLimit),
            text: '',
            message: 'offset past end'
          })
        }
        const text = markdown.slice(startOffset, startOffset + clampedLimit)
        const nextOffset =
          startOffset + text.length < totalChars ? startOffset + text.length : null
        return JSON.stringify({
          docId: id,
          title: doc.title ?? doc.fileName,
          source: 'mineru_ocr',
          profile: result.profile,
          resultKey: result.resultKey,
          offset: startOffset,
          limit: clampedLimit,
          totalChars,
          nextOffset,
          chunkIndex: Math.floor(startOffset / clampedLimit),
          chunkCount: Math.ceil(totalChars / clampedLimit),
          text
        })
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to read OCR full text',
          docId: id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })

  const preparePaperOcr = createStructuredHostOperation({
    name: 'prepare_paper_ocr',
    func: async ({ docId }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const id = docId.trim()
      const doc = repos.documents.get(id)
      if (!doc) {
        return JSON.stringify({ error: 'Document not found', docId: id })
      }
      if (!mineruDocumentService) {
        return JSON.stringify({ error: 'OCR service is unavailable', docId: id })
      }
      try {
        const { result, markdown } = await mineruDocumentService.prepareForAgent(id, signal)
        if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
        return JSON.stringify({
          docId: id,
          title: doc.title ?? doc.fileName,
          source: 'mineru_ocr',
          profile: result.profile,
          resultKey: result.resultKey,
          totalChars: markdown.length,
          message: 'Balanced OCR cache is ready. Continue with read_paper_ocr_fulltext.'
        })
      } catch (error) {
        return JSON.stringify({
          error: 'Failed to prepare OCR full text',
          docId: id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
  })

  const getPaperSummary = createStringHostOperation({
    name: 'get_paper_summary',
    argumentName: 'docId',
    func: async (docId: string) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const summary = repos.aiSummaries.getSummary(docId.trim())
      if (!summary || !summary.content) return 'No summary available yet.'
      const content: AiSummaryContent = summary.content
      return JSON.stringify(content)
    }
  })

  const generateReport = createStructuredHostOperation({
    name: 'generate_report',
    func: async ({ title, contentMd, sourceDocIds }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const allowedDocIds = new Set(
        repos.workspaceItems
          .list(workspaceId)
          .filter((item) => item.kind === 'document' && item.docId)
          .map((item) => item.docId as string)
      )
      const ids = parseSourceDocIds(sourceDocIds).filter((id) => allowedDocIds.has(id))
      const report = repos.transaction(() => {
        const created = repos.aiReports.create({
          workspaceId,
          title,
          contentMd,
          sourceDocIds: ids,
          model: providerModel
        })
        repos.workspaceItems.add(workspaceId, 'report', [created.id])
        return created
      })
      const w = getWin()
      if (w) {
        emitAiReportCreated(w, report)
        emitWorkspaceItemsChanged(w, { workspaceId, reason: 'other' })
      }
      return JSON.stringify({
        created: true,
        reportId: report.id,
        title: report.title,
        workspaceId,
        sourceDocIds: report.sourceDocIds
      })
    }
  })

  const addDocsToWorkspace = createStructuredHostOperation({
    name: 'add_docs_to_workspace',
    func: async ({ docIds }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const ids = parseSourceDocIds(docIds)
      if (ids.length === 0) {
        return JSON.stringify({
          added: [],
          alreadyInWorkspace: [],
          missing: [],
          error: 'No docIds provided.'
        })
      }
      const existingItems = repos.workspaceItems
        .list(workspaceId)
        .filter((i) => i.kind === 'document')
        .map((i) => i.docId)
        .filter((d): d is string => d !== null)
      const existingSet = new Set(existingItems)
      const added: string[] = []
      const alreadyInWorkspace: string[] = []
      const missing: string[] = []
      const validIds: string[] = []
      for (const id of ids) {
        const doc = repos.documents.get(id)
        if (!doc) {
          missing.push(id)
          continue
        }
        if (existingSet.has(id)) {
          alreadyInWorkspace.push(id)
          continue
        }
        validIds.push(id)
      }
      if (validIds.length > 0) {
        repos.workspaceItems.add(workspaceId, 'document', validIds)
        added.push(...validIds)
        const w = getWin()
        if (w) {
          emitWorkspaceItemsChanged(w, {
            workspaceId,
            reason: 'agent_add_docs',
            docIds: added
          })
        }
      }
      return JSON.stringify({ added, alreadyInWorkspace, missing })
    }
  })

  const requestSummary = createStructuredHostOperation({
    name: 'request_summary',
    func: async ({ docId }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const doc = repos.documents.get(docId.trim())
      if (!doc) {
        return JSON.stringify({ status: 'error', message: 'Document not found.' })
      }
      const existing = repos.aiSummaries.getSummary(docId.trim())
      if (existing && existing.content) {
        return JSON.stringify({ status: 'ready', summary: existing.content })
      }
      aiSummaryService.summarize(docId.trim())
      return JSON.stringify({ status: 'queued', docId: docId.trim() })
    }
  })

  const searchLibrary = createStringHostOperation({
    name: 'search_library',
    argumentName: 'query',
    func: async (query: string) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const q = query.trim()
      if (!q) return '[]'
      const results = repos.documents.search(q).slice(0, 20)
      return JSON.stringify(
        results.map((d) => ({
          docId: d.id,
          title: d.title ?? d.fileName,
          authors: d.authors,
          year: d.year
        }))
      )
    }
  })

  const getPaperMetadata = createStringHostOperation({
    name: 'get_paper_metadata',
    argumentName: 'docId',
    func: async (docId: string) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const doc = repos.documents.get(docId.trim())
      if (!doc) return 'Document not found.'
      return JSON.stringify({
        docId: doc.id,
        title: doc.title,
        authors: doc.authors,
        year: doc.year,
        venue: doc.venue,
        volume: doc.volume,
        issue: doc.issue,
        pages: doc.pages,
        abstract: doc.abstract,
        keywords: doc.keywords,
        doi: doc.doi,
        arxivId: doc.arxivId,
        url: doc.url
      })
    }
  })

  const openPaper = createStringHostOperation({
    name: 'open_paper',
    argumentName: 'docId',
    func: async (docId: string) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const id = docId.trim()
      const wsItems = workspaceId
        ? repos.workspaceItems.list(workspaceId).filter((i) => i.kind === 'document')
        : []
      const wsDocIds = new Set(wsItems.map((i) => i.docId).filter((d): d is string => d !== null))
      if (workspaceId && !wsDocIds.has(id)) {
        return 'Document is not in the current workspace. Use search_workspace_docs to find papers in this workspace.'
      }
      try {
        const doc = await openPdf(repos, getWin(), id)
        return `Opened: ${doc.title ?? doc.fileName}`
      } catch (e) {
        return `Failed to open: ${e instanceof Error ? e.message : String(e)}`
      }
    }
  })

  const publishWorkspaceArtifacts = createStructuredHostOperation({
    name: 'publish_workspace_artifacts',
    func: async ({ paths, x, y }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      if (!agentArtifactPublisher) return JSON.stringify({ error: 'Artifact publishing is unavailable' })
      const placement = x === undefined || y === undefined ? undefined : { x, y }
      try {
        return JSON.stringify(await agentArtifactPublisher.publish(req.workspaceId, paths, placement))
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      }
    }
  })

  const installRuntimePackages = createStructuredHostOperation({
    name: 'install_runtime_packages',
    func: async ({ runtimes, python, node }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      if (!agentRuntimeManager) return JSON.stringify({ error: 'Runtime package installation is unavailable' })
      try {
        return JSON.stringify(await agentRuntimeManager.installPackages(req.workspaceId, python, node, runtimes))
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
      }
    }
  })

  const proposeWorkspaceMemoryUpdate = createStructuredHostOperation({
    name: 'propose_workspace_memory_update',
    func: async ({ path, content, rationale }) => {
      if (signal.aborted) return JSON.stringify({ error: 'Cancelled' })
      const memory = repos.transaction(() => updateWorkspaceMemory(repos, {
        workspaceId: req.workspaceId,
        path,
        content,
        sourceThreadId: req.threadId ?? '',
        sourceRunId: req.runId ?? ''
      }))
      return JSON.stringify({
        updated: true,
        path: memory.path,
        revision: memory.revision,
        rationale
      })
    }
  })

  const academicTools: AgentHostOperation[] = []
  if (academicResearch) {
    const academicResult = async (operation: () => Promise<unknown>): Promise<string> => {
      if (signal.aborted) return JSON.stringify({ error: { code: 'cancelled', message: 'Cancelled' } })
      try {
        return JSON.stringify(await operation())
      } catch (error) {
        const value = error as { code?: unknown; message?: unknown }
        return JSON.stringify({
          error: {
            code: typeof value?.code === 'string' ? value.code : 'academic_research_failed',
            message: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    academicTools.push(
      createStructuredHostOperation({
        name: 'search_arxiv',
        func: async (input) => academicResult(() => academicResearch.arxivClient.search(input, signal))
      }),
      createStructuredHostOperation({
        name: 'get_arxiv_paper',
        func: async (input) => academicResult(async () => {
          try {
            return await academicResearch.arxivPaperService.getPaper(input, signal)
          } catch (error) {
            const value = error as { code?: unknown }
            if (value?.code === 'arxiv_html_unavailable') {
              const normalizedArxivId = normalizeArxivId(input.arxivId) ?? input.arxivId
              return {
                error: {
                  code: 'arxiv_html_unavailable',
                  message: error instanceof Error ? error.message : String(error)
                },
                absUrl: `https://arxiv.org/abs/${normalizedArxivId}`,
                pdfUrl: `https://arxiv.org/pdf/${normalizedArxivId}`
              }
            }
            throw error
          }
        })
      }),
      createStructuredHostOperation({
        name: 'resolve_academic_identity',
        func: async ({ paper }) => academicResult(
          () => academicResearch.identityService.resolve(paper, signal)
        )
      }),
      createStructuredHostOperation({
        name: 'get_citing_papers',
        func: async ({ paper, cursor, limit, publishedAfter }) => academicResult(
          () => academicResearch.graphService.getCitingPapers(
            paper,
            cursor,
            limit,
            signal,
            { publishedAfter }
          )
        )
      }),
      createStructuredHostOperation({
        name: 'get_referenced_papers',
        func: async ({ paper, cursor, limit, publishedAfter }) => academicResult(
          () => academicResearch.graphService.getReferencedPapers(
            paper,
            cursor,
            limit,
            signal,
            { publishedAfter }
          )
        )
      }),
      createStructuredHostOperation({
        name: 'get_semantic_recommendations',
        func: async ({ paper, limit }) => academicResult(
          () => academicResearch.graphService.getRecommendations(paper, limit, signal)
        )
      }),
      createStructuredHostOperation({
        name: 'explore_research_frontier',
        func: async (input) => academicResult(async () => {
          const threadId = req.threadId ?? req.runId ?? ''
          if (input.action === 'start') {
            if (!input.seed || !input.objective?.trim()) {
              throw new Error('start requires seed and objective')
            }
            return academicResearch.frontierService.start({
              workspaceId,
              threadId,
              seed: input.seed,
              objective: input.objective,
              branches: input.branches,
              searchQueries: input.searchQueries,
              publishedAfter: input.publishedAfter,
              strictArxivOnly: input.strictArxivOnly
            }, signal)
          }
          if (input.action === 'expand') {
            if (!input.frontierId || !input.paperIds?.length) {
              throw new Error('expand requires frontierId and paperIds')
            }
            return academicResearch.frontierService.expand({
              workspaceId,
              threadId,
              frontierId: input.frontierId,
              paperIds: input.paperIds
            }, signal)
          }
          if (!input.frontierId || !input.resumeToken) {
            throw new Error('continue requires frontierId and resumeToken')
          }
          return academicResearch.frontierService.continuePage({
            workspaceId,
            threadId,
            frontierId: input.frontierId,
            resumeToken: input.resumeToken
          }, signal)
        })
      })
    )
  }

  const webAccessTools = webSearchService?.isEnabled()
    ? [
        createStructuredHostOperation({
          name: 'web_search',
          func: async (input) => {
            try {
              return JSON.stringify(await webSearchService.search(input, signal))
            } catch (error) {
              const value = error as { code?: unknown }
              return JSON.stringify({
                error: {
                  code: typeof value?.code === 'string' ? value.code : 'web_search_failed',
                  message: error instanceof Error ? error.message : String(error)
                }
              })
            }
          }
        }),
        createStructuredHostOperation({
          name: 'web_fetch',
          func: async (input) => {
            try {
              return JSON.stringify(await webSearchService.fetchPage(input, signal))
            } catch (error) {
              const value = error as { code?: unknown }
              return JSON.stringify({
                error: {
                  code: typeof value?.code === 'string' ? value.code : 'web_fetch_failed',
                  message: error instanceof Error ? error.message : String(error)
                }
              })
            }
          }
        })
      ]
    : []

  const executeSandbox = agentExecutionService
    ? createStructuredHostOperation({
        name: '__execute',
        func: async ({ command }) => {
          try {
            const result = await agentExecutionService.execute({
              workspaceId: req.workspaceId,
              script: command,
              cwd: '.',
              timeoutSeconds: 300,
              signal
            })
            return JSON.stringify({
              output: [result.stdout, result.stderr].filter(Boolean).join('\n'),
              exitCode: result.exitCode,
              truncated: result.truncated
            })
          } catch (error) {
            return JSON.stringify({
              output: error instanceof Error ? error.message : String(error),
              exitCode: null,
              truncated: false
            })
          }
        }
      })
    : null

  const libraryTools = [
    searchLibrary,
    findRelatedPapers,
    readPaperFulltext,
    readPaperOcrFulltext,
    preparePaperOcr,
    getPaperSummary,
    getPaperMetadata,
    openPaper,
    requestSummary
  ]
  if (!workspaceId) {
    return [
      ...(executeSandbox ? [executeSandbox] : []),
      ...libraryTools,
      ...academicTools,
      ...webAccessTools,
      installRuntimePackages,
      publishWorkspaceArtifacts,
      proposeWorkspaceMemoryUpdate
    ]
  }
  return [
    ...(executeSandbox ? [executeSandbox] : []),
    listWorkspaceContext,
    searchWorkspaceDocs,
    ...libraryTools.slice(0, -1),
    ...academicTools,
    ...webAccessTools,
    generateReport,
    createWorkspaceConnections,
    addDocsToWorkspace,
    requestSummary,
    installRuntimePackages,
    publishWorkspaceArtifacts,
    proposeWorkspaceMemoryUpdate
  ]

}
