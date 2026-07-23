import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  ArxivSearchPaper,
  PaperIdentity,
  PaperLocator
} from '../../src/shared/academicResearch'
import type { AcademicGraphService } from '../../src/main/services/academicGraphService'
import type { AcademicIdentityService } from '../../src/main/services/academicIdentityService'
import type { ArxivClient } from '../../src/main/services/arxivClient'
import {
  createResearchFrontierService,
  createResearchFrontierSessionStore
} from '../../src/main/services/researchFrontierService'

function paper(id: string, title: string, year: number): PaperIdentity {
  return {
    canonicalId: `s2:${id}`,
    semanticScholarPaperId: id,
    title,
    authors: [{ name: `${title} Author` }],
    year,
    publicationDate: `${year}-01-01`,
    abstract: `${title} abstract`,
    matchStatus: 'exact',
    evidence: [{
      provider: 'semantic_scholar',
      identifier: id,
      matchedBy: 'test'
    }]
  }
}

function arxivPaper(id: string, title: string): ArxivSearchPaper {
  return {
    arxivId: id,
    title,
    authors: [`${title} Author`],
    abstract: `${title} abstract`,
    publishedAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    categories: ['cs.AI'],
    absUrl: `https://arxiv.org/abs/${id}`,
    htmlUrl: `https://arxiv.org/html/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`
  }
}

function delayed<T>(value: T, delayMs: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), delayMs))
}

describe('createResearchFrontierService', () => {
  it('groups initial candidates and expands only Agent-selected paper IDs', async () => {
    const seed = paper('seed', 'Seed', 2023)
    const selected = paper('selected', 'Semantically selected', 2025)
    const next = paper('next', 'Next frontier', 2026)
    const getCitingPapers = vi.fn()
      .mockResolvedValueOnce({
        seed,
        direction: 'incoming',
        items: [{
          paper: selected,
          citationEvidence: {
            contexts: ['Extends the central argument.'],
            intents: ['methodology'],
            isInfluential: false
          }
        }],
        total: 1,
        coverage: { scanned: 1, total: 1, complete: true },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false
      })
      .mockResolvedValueOnce({
        seed: selected,
        direction: 'incoming',
        items: [{ paper: selected }, { paper: seed }, { paper: next }, { paper: next }],
        total: 4,
        coverage: { scanned: 4, total: 4, complete: true },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false
      })
    const identityService = {
      resolve: vi.fn(async () => seed),
      localDocumentId: vi.fn(() => null),
      toSemanticScholarLocator: vi.fn((identity: PaperIdentity) => ({
        type: 's2_paper_id' as const,
        value: identity.semanticScholarPaperId!
      }))
    } as unknown as AcademicIdentityService
    const graphService = {
      getCitingPapers,
      getRecommendations: vi.fn(async () => ({
        seed: selected,
        items: [next],
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false
      }))
    } as unknown as AcademicGraphService
    const arxivClient = { search: vi.fn() } as unknown as ArxivClient
    const service = createResearchFrontierService(
      identityService,
      graphService,
      arxivClient
    )

    const first = await service.start({
      workspaceId: 'workspace-1',
      threadId: 'thread-1',
      seed: { type: 's2_paper_id', value: 'seed' },
      objective: 'Find the latest extension',
      branches: ['citations']
    })

    expect(first.groups.citingPapers).toEqual([
      expect.objectContaining({
        canonicalId: 's2:selected',
        title: 'Semantically selected',
        discoveredBy: ['citation:s2:seed'],
        citationContexts: ['Extends the central argument.']
      })
    ])
    expect(first).not.toHaveProperty('score')
    expect(first.nextActions[0]).toMatchObject({ type: 'expand' })

    const expanded = await service.expand({
      workspaceId: 'workspace-1',
      threadId: 'thread-1',
      frontierId: first.frontierId,
      paperIds: ['s2:selected']
    })

    expect(expanded.round).toBe(1)
    expect(expanded.expandedFrom).toEqual(['s2:selected'])
    expect(expanded.groups.citingPapers[0]).toMatchObject({
      canonicalId: 's2:next',
      graphDistance: 2
    })
    expect(expanded.groups.citingPapers).toHaveLength(1)
    expect(expanded.groups.recommendations).toHaveLength(0)
    expect(identityService.toSemanticScholarLocator).toHaveBeenCalledWith(selected)
  })

  it('merges concurrent branches in deterministic order with unique bounded candidates', async () => {
    const seed = paper('seed', 'Seed', 2023)
    const shared = {
      ...paper('shared', 'Shared', 2025),
      canonicalId: 'arxiv:2501.99999',
      arxivId: '2501.99999'
    }
    const citations = [
      seed,
      shared,
      ...Array.from({ length: 13 }, (_, index) =>
        paper(`citation-${index}`, `Citation ${index}`, 2025))
    ]
    const recommendations = [
      seed,
      shared,
      ...Array.from({ length: 14 }, (_, index) =>
        paper(`recommendation-${index}`, `Recommendation ${index}`, 2025))
    ]
    const arxivByQuery = {
      first: [
        arxivPaper('2501.99999', 'Shared'),
        ...Array.from({ length: 14 }, (_, index) =>
          arxivPaper(`2502.${String(index).padStart(5, '0')}`, `Arxiv A ${index}`))
      ],
      second: Array.from({ length: 15 }, (_, index) =>
        arxivPaper(`2503.${String(index).padStart(5, '0')}`, `Arxiv B ${index}`))
    }

    async function runWithDelays(delays: {
      citations: number
      recommendations: number
      first: number
      second: number
    }) {
      const getCitingPapers = vi.fn(() => delayed({
        seed,
        direction: 'incoming' as const,
        items: citations.map((candidate) => ({ paper: candidate })),
        total: citations.length,
        coverage: {
          scanned: citations.length,
          total: citations.length,
          complete: true
        },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false
      }, delays.citations))
      const graphService = {
        getCitingPapers,
        getRecommendations: vi.fn(() => delayed({
          seed,
          items: recommendations,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        }, delays.recommendations))
      } as unknown as AcademicGraphService
      const identityService = {
        resolve: vi.fn(async () => seed),
        localDocumentId: vi.fn(() => null)
      } as unknown as AcademicIdentityService
      const arxivClient = {
        search: vi.fn(({ query }: { query: 'first' | 'second' }) => delayed({
          papers: arxivByQuery[query],
          total: arxivByQuery[query].length,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        }, delays[query]))
      } as unknown as ArxivClient
      const service = createResearchFrontierService(
        identityService,
        graphService,
        arxivClient
      )
      const frontier = await service.start({
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        seed: { type: 's2_paper_id', value: 'seed' },
        objective: 'Explore',
        searchQueries: ['first', 'second'],
        publishedAfter: '2024-01-01'
      })
      expect(getCitingPapers).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        15,
        undefined,
        { publishedAfter: '2024-01-01' }
      )
      return frontier
    }

    const slowCitations = await runWithDelays({
      citations: 20,
      recommendations: 1,
      first: 10,
      second: 2
    })
    const slowArxiv = await runWithDelays({
      citations: 1,
      recommendations: 10,
      first: 20,
      second: 15
    })
    const ids = (frontier: Awaited<ReturnType<typeof runWithDelays>>) => [
      ...frontier.groups.citingPapers,
      ...frontier.groups.recommendations,
      ...frontier.groups.recentArxivPapers
    ].map((candidate) => candidate.canonicalId)

    expect(ids(slowCitations)).toEqual(ids(slowArxiv))
    expect(ids(slowCitations)).toHaveLength(50)
    expect(new Set(ids(slowCitations)).size).toBe(50)
    expect(ids(slowCitations)).not.toContain(seed.canonicalId)
    expect(ids(slowCitations).filter((id) => id === shared.canonicalId)).toHaveLength(1)
    expect(slowCitations.warnings).toContain(
      'candidate_limit_reached: retained the first 50 unique candidates in deterministic branch order'
    )
  })

  it('isolates in-memory frontier sessions by workspace and thread', async () => {
    const seed = paper('seed', 'Seed', 2023)
    const identityService = {
      resolve: vi.fn(async () => seed),
      localDocumentId: vi.fn(() => null)
    } as unknown as AcademicIdentityService
    const graphService = {
      getCitingPapers: vi.fn(async () => ({
        seed,
        direction: 'incoming',
        items: [],
        coverage: { scanned: 0, complete: true },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false
      }))
    } as unknown as AcademicGraphService
    const service = createResearchFrontierService(
      identityService,
      graphService,
      { search: vi.fn() } as unknown as ArxivClient
    )
    const view = await service.start({
      workspaceId: 'workspace-1',
      threadId: 'thread-1',
      seed: { type: 's2_paper_id', value: 'seed' },
      objective: 'Explore',
      branches: ['citations']
    })

    await expect(service.expand({
      workspaceId: 'workspace-1',
      threadId: 'another-thread',
      frontierId: view.frontierId,
      paperIds: ['s2:any']
    })).rejects.toThrow('not found or has expired')
  })

  it.each([
    'document_id',
    's2_corpus_id'
  ] satisfies PaperLocator['type'][])(
    'restores citation pagination with a %s locator after restart',
    async (locatorType) => {
      const directory = await mkdtemp(join(tmpdir(), 'refora-frontier-locator-'))
      try {
        const seed = paper('seed', 'Seed', 2023)
        const getCitingPapers = vi.fn()
          .mockResolvedValueOnce({
            seed,
            direction: 'incoming',
            items: [],
            nextCursor: 'next-citation-page',
            coverage: { scanned: 0, total: 1, complete: false },
            fetchedAt: '2026-01-01T00:00:00.000Z',
            cached: false
          })
          .mockResolvedValueOnce({
            seed,
            direction: 'incoming',
            items: [],
            coverage: { scanned: 0, total: 1, complete: true },
            fetchedAt: '2026-01-01T00:00:00.000Z',
            cached: false
          })
        const identityService = {
          resolve: vi.fn(async () => seed),
          localDocumentId: vi.fn(() => null)
        } as unknown as AcademicIdentityService
        const graphService = {
          getCitingPapers
        } as unknown as AcademicGraphService
        const arxivClient = { search: vi.fn() } as unknown as ArxivClient
        const locator: PaperLocator = {
          type: locatorType,
          value: locatorType === 'document_id' ? 'document-1' : '12345'
        }
        const sessionRoot = join(directory, 'sessions')
        const firstService = createResearchFrontierService(
          identityService,
          graphService,
          arxivClient,
          sessionRoot
        )
        const first = await firstService.start({
          workspaceId: 'workspace-1',
          threadId: 'thread-1',
          seed: locator,
          objective: 'Resume citations',
          branches: ['citations']
        })
        const resumeToken = first.nextActions.find((action) => action.type === 'continue')
          ?.resumeToken
        expect(resumeToken).toBeTruthy()

        const reopenedService = createResearchFrontierService(
          identityService,
          graphService,
          arxivClient,
          sessionRoot
        )
        await reopenedService.continuePage({
          workspaceId: 'workspace-1',
          threadId: 'thread-1',
          frontierId: first.frontierId,
          resumeToken: resumeToken!
        })

        expect(getCitingPapers).toHaveBeenNthCalledWith(
          2,
          locator,
          'next-citation-page',
          15,
          undefined,
          { publishedAfter: undefined }
        )
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  )

  it('prunes interrupted writes and enforces persisted session budgets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'refora-frontier-budget-'))
    try {
      const store = createResearchFrontierSessionStore(directory)
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      const createSession = (
        id: string
      ): Parameters<typeof store.save>[0] => {
        const seed = paper(`seed-${id}`, `Seed ${id}`, 2025)
        return {
          id,
          workspaceId: 'workspace-1',
          threadId: `thread-${id}`,
          objective: 'Budget test',
          seed,
          round: 0,
          expansionsUsed: 0,
          visitedIds: new Set([seed.canonicalId]),
          nodes: new Map(),
          resumes: new Map(),
          strictArxivOnly: false,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000
        }
      }
      for (const id of ids) await store.save(createSession(id))
      const baseTime = Date.now() - 10_000
      for (const [index, id] of ids.entries()) {
        const time = new Date(baseTime + index * 1_000)
        await utimes(join(directory, `${id}.json`), time, time)
      }
      const temporary = join(
        directory,
        `${randomUUID()}.json.${randomUUID()}.tmp`
      )
      await writeFile(temporary, 'partial session')

      const countPrune = await store.prune(Date.now(), {
        maxSessions: 2,
        maxBytes: Number.MAX_SAFE_INTEGER
      })
      expect(countPrune.remainingFiles).toBe(2)
      expect(await store.load(ids[0])).toBeNull()
      expect(await store.load(ids[1])).not.toBeNull()
      expect(await store.load(ids[2])).not.toBeNull()
      await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })

      const newestSize = (await stat(join(directory, `${ids[2]}.json`))).size
      const bytePrune = await store.prune(Date.now(), {
        maxSessions: 2,
        maxBytes: newestSize
      })
      expect(bytePrune.remainingFiles).toBe(1)
      expect(bytePrune.remainingBytes).toBe(newestSize)
      expect(await store.load(ids[1])).toBeNull()
      expect(await store.load(ids[2])).not.toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('restores candidates and resume tokens from files after service restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'refora-frontier-'))
    try {
      const sessionRoot = join(directory, 'sessions')
      const seed = paper('seed', 'Seed', 2023)
      const selected = paper('selected', 'Selected', 2025)
      const expanded = paper('expanded', 'Expanded', 2026)
      const continued = paper('continued', 'Continued', 2026)
      const getCitingPapers = vi.fn()
        .mockResolvedValueOnce({
          seed,
          direction: 'incoming',
          items: [{ paper: selected }],
          nextCursor: 'citation-page-2',
          coverage: { scanned: 1, total: 2, complete: false },
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        })
        .mockResolvedValueOnce({
          seed: selected,
          direction: 'incoming',
          items: [{ paper: expanded }],
          coverage: { scanned: 1, total: 1, complete: true },
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        })
        .mockResolvedValueOnce({
          seed,
          direction: 'incoming',
          items: [{ paper: continued }],
          coverage: { scanned: 1, total: 2, complete: true },
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        })
      const identityService = {
        resolve: vi.fn(async () => seed),
        localDocumentId: vi.fn(() => null),
        toSemanticScholarLocator: vi.fn((identity: PaperIdentity) => ({
          type: 's2_paper_id' as const,
          value: identity.semanticScholarPaperId!
        }))
      } as unknown as AcademicIdentityService
      const graphService = {
        getCitingPapers,
        getRecommendations: vi.fn(async () => ({
          seed: selected,
          items: [],
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false
        }))
      } as unknown as AcademicGraphService
      const arxivClient = { search: vi.fn() } as unknown as ArxivClient

      const firstService = createResearchFrontierService(
        identityService,
        graphService,
        arxivClient,
        sessionRoot
      )
      const first = await firstService.start({
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        seed: { type: 's2_paper_id', value: 'seed' },
        objective: 'Resume after restart',
        branches: ['citations']
      })
      const resumeToken = first.nextActions.find((action) => action.type === 'continue')
        ?.resumeToken
      expect(resumeToken).toBeTruthy()

      const secondService = createResearchFrontierService(
        identityService,
        graphService,
        arxivClient,
        sessionRoot
      )
      const second = await secondService.expand({
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        frontierId: first.frontierId,
        paperIds: ['s2:selected']
      })
      expect(second.groups.citingPapers).toEqual([
        expect.objectContaining({ canonicalId: 's2:expanded' })
      ])

      const thirdService = createResearchFrontierService(
        identityService,
        graphService,
        arxivClient,
        sessionRoot
      )
      const third = await thirdService.continuePage({
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        frontierId: first.frontierId,
        resumeToken: resumeToken!
      })
      expect(third.groups.citingPapers).toEqual([
        expect.objectContaining({ canonicalId: 's2:continued' })
      ])

      await thirdService.deleteThread('thread-1')
      const fourthService = createResearchFrontierService(
        identityService,
        graphService,
        arxivClient,
        sessionRoot
      )
      await expect(fourthService.expand({
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        frontierId: first.frontierId,
        paperIds: ['s2:expanded']
      })).rejects.toThrow('not found or has expired')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
