import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'

describe('agent sandbox service', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  function setup() {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-sandbox-'))
    directories.push(library)
    const trashItem = vi.fn(async () => undefined)
    const service = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db'),
      trashItem
    })
    return { service, trashItem }
  }

  it('shares runtimes and stores while keeping workspace roots separate', async () => {
    const { service } = setup()
    const first = await service.ensure('workspace-a')
    const second = await service.ensure('workspace-b')
    const fallback = await service.ensure(null)

    expect(first.sharedRoot).toBe(second.sharedRoot)
    expect(first.runtimeRoot).toBe(fallback.runtimeRoot)
    expect(first.databaseSnapshot).toBe(second.databaseSnapshot)
    expect(first.sandboxRoot).not.toBe(second.sandboxRoot)
    expect(fallback.sandboxRoot).toMatch(/\.refora-agent\/default$/)
    expect(existsSync(first.workRoot)).toBe(true)
    expect(existsSync(second.outputsRoot)).toBe(true)
    expect(existsSync(join(first.sandboxRoot, 'inputs'))).toBe(false)
    expect(existsSync(join(first.environmentRoot, 'node', 'node_modules'))).toBe(false)
    expect(existsSync(join(first.environmentRoot, 'python', '.venv'))).toBe(false)
  })

  it('rejects absolute paths, traversal, and directories as artifacts', async () => {
    const { service } = setup()
    const paths = await service.ensure('workspace-a')
    writeFileSync(join(paths.outputsRoot, 'result.csv'), 'a,b\n1,2\n')

    expect(service.requireRegularFile('workspace-a', 'outputs/result.csv')).toBe(join(paths.outputsRoot, 'result.csv'))
    expect(() => service.resolveInside('workspace-a', '../escape.txt')).toThrow('outside')
    expect(() => service.resolveInside('workspace-a', '/tmp/escape.txt')).toThrow('relative')
    expect(() => service.requireRegularFile('workspace-a', 'outputs')).toThrow('regular files')
  })

  it('moves a workspace sandbox through the supplied trash operation', async () => {
    const { service, trashItem } = setup()
    const paths = await service.ensure('workspace-a')
    await service.deleteWorkspace('workspace-a')
    expect(trashItem).toHaveBeenCalledWith(paths.sandboxRoot)
  })
})
