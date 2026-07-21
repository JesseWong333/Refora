import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentDatabaseSnapshotService } from '../../src/main/services/agentDatabaseSnapshot'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'

describe('agent database snapshot service', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('keeps one shared snapshot and coalesces concurrent refreshes', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-db-'))
    directories.push(library)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db')
    })
    const backup = vi.fn(async (destination: string) => {
      await writeFile(destination, 'snapshot')
    })
    const service = createAgentDatabaseSnapshotService({ db: { backup } as never, sandboxService })

    const [first, second] = await Promise.all([service.refresh(), service.refresh()])

    expect(first).toBe(second)
    expect(backup).toHaveBeenCalledTimes(1)
    expect(readFileSync(first, 'utf8')).toBe('snapshot')
    expect(first).toMatch(/\.refora-agent\/shared\/database\/refora-readonly\.db$/)
  })
})
