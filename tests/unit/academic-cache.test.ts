import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAcademicCache } from '../../src/main/services/academicCache'

describe('createAcademicCache', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-academic-cache-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('removes expired JSON entries when they are read', async () => {
    const cache = createAcademicCache(directory)
    await cache.setJson('search', 'expired', { value: 1 }, -1)
    const filesBefore = await import('node:fs/promises').then(({ readdir }) =>
      readdir(cache.path('search'))
    )

    await expect(cache.getJson('search', 'expired')).resolves.toBeNull()
    expect(filesBefore).toHaveLength(1)
    await expect(import('node:fs/promises').then(({ readdir }) =>
      readdir(cache.path('search'))
    )).resolves.toHaveLength(0)
  })

  it('prunes old full-text files and enforces a total size cap', async () => {
    const cache = createAcademicCache(directory)
    const oldPath = cache.path('arxiv-paper', 'old', 'document.md')
    const newerPath = cache.path('arxiv-paper', 'new', 'document.md')
    await cache.writeText(oldPath, 'o'.repeat(20))
    await cache.writeText(newerPath, 'n'.repeat(20))
    const oldDate = new Date(Date.now() - 10_000)
    utimesSync(oldPath, oldDate, oldDate)

    const byAge = await cache.prune({ maxAgeMs: 1_000, maxBytes: 100 })
    expect(byAge.deletedFiles).toBe(1)
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(newerPath)).toBe(true)

    const bySize = await cache.prune({ maxAgeMs: 60_000, maxBytes: 0 })
    expect(bySize.remainingBytes).toBe(0)
    expect(existsSync(newerPath)).toBe(false)
  })
})
