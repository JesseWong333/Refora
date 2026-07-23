import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAcademicCache } from '../../src/main/services/academicCache'
import { createSemanticScholarClient } from '../../src/main/services/semanticScholarClient'

const SEED = {
  paperId: 'seed-paper',
  corpusId: 10,
  externalIds: { ArXiv: '2401.00001' },
  title: 'Seed paper',
  authors: [{ authorId: 'author-1', name: 'Seed Author' }],
  year: 2024,
  citationCount: 12,
  referenceCount: 8
}

describe('createSemanticScholarClient', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-s2-client-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('resolves exact identities from an arXiv ID', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(SEED), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const client = createSemanticScholarClient(fetchFn, createAcademicCache(directory))

    const paper = await client.getPaper({ type: 'arxiv_id', value: '2401.00001' })

    expect(paper).toMatchObject({
      canonicalId: 'arxiv:2401.00001',
      arxivId: '2401.00001',
      semanticScholarPaperId: 'seed-paper',
      semanticScholarCorpusId: 10,
      matchStatus: 'exact'
    })
    expect(fetchFn.mock.calls[0][0]).toContain('/paper/ARXIV%3A2401.00001?')
  })

  it('treats citations as incoming edges and exposes pagination coverage', async () => {
    const cache = createAcademicCache(directory)
    await cache.setJson('s2-paper', 'ARXIV:2401.00001', SEED, 60_000)
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      offset: 0,
      next: 1,
      total: 3,
      data: [{
        contexts: ['Builds on the seed method.'],
        intents: ['methodology'],
        isInfluential: true,
        citingPaper: {
          paperId: 'newer-paper',
          externalIds: { DOI: '10.1000/newer' },
          title: 'Newer citing paper',
          authors: [{ name: 'New Author' }],
          year: 2025,
          publicationDate: '2025-05-01'
        },
        citedPaper: {
          paperId: 'wrong-direction',
          title: 'Referenced paper',
          authors: []
        }
      }]
    }), { status: 200 }))
    const client = createSemanticScholarClient(fetchFn, cache)

    const page = await client.getCitingPapers(
      { type: 'arxiv_id', value: '2401.00001' },
      undefined,
      1,
      undefined,
      { publishedAfter: '2025-01-01' }
    )

    expect(page.direction).toBe('incoming')
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      paper: {
        canonicalId: 'doi:10.1000/newer',
        title: 'Newer citing paper'
      },
      citationEvidence: {
        contexts: ['Builds on the seed method.'],
        intents: ['methodology'],
        isInfluential: true
      }
    })
    expect(page.nextCursor).toBeTypeOf('string')
    expect(page.coverage).toEqual({ scanned: 1, total: 3, complete: false })
    expect(fetchFn.mock.calls[0][0]).toContain('/citations?')
    expect(fetchFn.mock.calls[0][0]).toContain('limit=1')
    expect(new URL(fetchFn.mock.calls[0][0]).searchParams.get('publicationDateOrYear'))
      .toBe('2025-01-01:')
  })
})
