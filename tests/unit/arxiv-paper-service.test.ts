import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAcademicCache } from '../../src/main/services/academicCache'
import type { ArxivClient } from '../../src/main/services/arxivClient'
import { createArxivPaperService } from '../../src/main/services/arxivPaperService'

describe('createArxivPaperService', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-arxiv-paper-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('converts official HTML to paginated Markdown and caches the converted document', async () => {
    const fetchHtml = vi.fn(async () => ({
      arxivId: '2401.12345v1',
      sourceUrl: 'https://arxiv.org/html/2401.12345v1',
      html: `
        <article class="ltx_document">
          <h1>Paper title</h1>
          <h2>Introduction</h2>
          <p>${'Research evidence. '.repeat(80)}</p>
          <h2>Results</h2>
          <p>${'Measured result. '.repeat(80)}</p>
        </article>
      `
    }))
    const client = { fetchHtml } as unknown as ArxivClient
    const service = createArxivPaperService(client, createAcademicCache(directory))

    const first = await service.getPaper({ arxivId: '2401.12345v1', maxChars: 500 })
    const second = await service.getPaper({
      arxivId: '2401.12345v1',
      cursor: first.nextCursor,
      maxChars: 500
    })

    expect(first).toMatchObject({
      arxivId: '2401.12345v1',
      sourceFormat: 'arxiv-html',
      outputFormat: 'markdown',
      title: 'Paper title',
      cached: false
    })
    expect(first.contentMd).toContain('# Paper title')
    expect(first.nextCursor).toBeTypeOf('string')
    expect(second.cursor).toBeGreaterThan(0)
    expect(second.cached).toBe(true)
    expect(fetchHtml).toHaveBeenCalledTimes(1)
    expect(first.sections.map((section) => section.title)).toEqual([
      'Paper title',
      'Introduction',
      'Results'
    ])
  })
})
