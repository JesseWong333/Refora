import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAcademicCache } from '../../src/main/services/academicCache'
import { createArxivClient } from '../../src/main/services/arxivClient'
import { resetArxivRateLimitForTests } from '../../src/main/services/arxivRateLimit'

const FEED = `
  <feed xmlns="http://www.w3.org/2005/Atom"
        xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
        xmlns:arxiv="http://arxiv.org/schemas/atom">
    <opensearch:totalResults>2</opensearch:totalResults>
    <entry>
      <id>https://arxiv.org/abs/2401.12345v2</id>
      <updated>2024-02-01T00:00:00Z</updated>
      <published>2024-01-31T00:00:00Z</published>
      <title> A useful paper </title>
      <summary> A bounded abstract. </summary>
      <author><name>Alice</name></author>
      <author><name>Bob</name></author>
      <category term="cs.AI"/>
      <arxiv:doi>10.1000/example</arxiv:doi>
    </entry>
  </feed>
`

describe('createArxivClient', () => {
  let directory: string

  beforeEach(() => {
    resetArxivRateLimitForTests()
    directory = mkdtempSync(join(tmpdir(), 'refora-arxiv-client-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('returns bounded paginated search metadata and reuses the filesystem cache', async () => {
    const fetchFn = vi.fn(async () => new Response(FEED, {
      status: 200,
      headers: { 'content-type': 'application/atom+xml' }
    }))
    const client = createArxivClient(fetchFn, createAcademicCache(directory))

    const first = await client.search({
      query: 'agentic research',
      pageSize: 1,
      sort: 'submitted_date',
      categories: ['cs.AI']
    })
    const second = await client.search({
      query: 'agentic research',
      pageSize: 1,
      sort: 'submitted_date',
      categories: ['cs.AI']
    })

    expect(first.cached).toBe(false)
    expect(first.total).toBe(2)
    expect(first.nextCursor).toBeTypeOf('string')
    expect(first.papers[0]).toMatchObject({
      arxivId: '2401.12345v2',
      title: 'A useful paper',
      authors: ['Alice', 'Bob'],
      categories: ['cs.AI'],
      doi: '10.1000/example',
      htmlUrl: 'https://arxiv.org/html/2401.12345v2'
    })
    expect(second.cached).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0][0]).toContain('sortBy=submittedDate')
    expect(fetchFn.mock.calls[0][0]).toContain('max_results=1')
  })

  it('accepts only official arXiv HTML responses', async () => {
    const response = new Response('<article><h1>Paper</h1></article>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
    Object.defineProperty(response, 'url', {
      value: 'https://arxiv.org/html/2401.12345'
    })
    const client = createArxivClient(
      vi.fn(async () => response),
      createAcademicCache(directory)
    )

    await expect(client.fetchHtml('https://arxiv.org/abs/2401.12345')).resolves.toEqual({
      arxivId: '2401.12345',
      sourceUrl: 'https://arxiv.org/html/2401.12345',
      html: '<article><h1>Paper</h1></article>'
    })
  })

  it('accepts physics archive categories with long suffixes', async () => {
    const fetchFn = vi.fn(async () => new Response(FEED, { status: 200 }))
    const client = createArxivClient(fetchFn, createAcademicCache(directory))

    await client.search({
      query: 'biological physics',
      categories: ['physics.bio-ph', 'physics.optics']
    })

    const requested = new URL(fetchFn.mock.calls[0][0])
    expect(requested.searchParams.get('search_query')).toContain('cat:physics.bio-ph')
    expect(requested.searchParams.get('search_query')).toContain('cat:physics.optics')
  })

  it('rejects malformed categories instead of silently dropping them', async () => {
    const fetchFn = vi.fn()
    const client = createArxivClient(fetchFn, createAcademicCache(directory))

    await expect(client.search({
      query: 'physics',
      categories: ['physics.bio-ph$']
    })).rejects.toMatchObject({
      code: 'invalid_arxiv_response'
    })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
