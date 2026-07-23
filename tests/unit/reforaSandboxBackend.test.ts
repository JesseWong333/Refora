import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'
import {
  createAgentExecutionService,
  createDirectAgentRunner
} from '../../src/main/services/agentExecution'
import { createReforaSandboxBackend } from '../../src/main/services/reforaSandboxBackend'

describe('Refora Deep Agent sandbox backend', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ))
  })

  it('routes execute through AgentExecutionService with Workspace scope', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-deep-agent-backend-'))
    directories.push(library)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db'),
      trashItem: vi.fn(async () => undefined)
    })
    const execute = vi.fn(async () => ({
      stdout: 'result',
      stderr: 'warning',
      exitCode: 0,
      timedOut: false,
      truncated: false,
      durationMs: 5
    }))
    const signal = new AbortController().signal
    const backend = await createReforaSandboxBackend({
      workspaceId: 'workspace-a',
      signal,
      executionService: { execute } as never,
      sandboxService
    })

    expect(await backend.execute('python scripts/analyze.py')).toEqual({
      output: 'result\nwarning',
      exitCode: 0,
      truncated: false
    })
    expect(execute).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      script: 'python scripts/analyze.py',
      cwd: '.',
      timeoutSeconds: 300,
      signal
    })
  })

  it('executes files created through virtual sandbox paths from the same sandbox root', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-deep-agent-execute-files-'))
    directories.push(library)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db')
    })
    const executionService = createAgentExecutionService({
      sandboxService,
      snapshotService: { refresh: vi.fn(async () => join(library, 'refora-readonly.db')) },
      readonlyFilesService: {
        writeManifest: vi.fn(async () => ({
          manifestPath: join(library, 'manifest.json'),
          files: []
        }))
      },
      runtimeManager: {
        resolve: vi.fn(async () => ({
          path: '/usr/bin:/bin',
          pythonPath: null,
          nodePath: null,
          uvPath: null,
          pnpmPath: null
        }))
      },
      runner: createDirectAgentRunner()
    } as never)
    const backend = await createReforaSandboxBackend({
      workspaceId: 'workspace-a',
      signal: new AbortController().signal,
      executionService,
      sandboxService
    })

    expect(await backend.write('/scripts/emit.sh', 'printf "same-root"')).toMatchObject({
      path: '/scripts/emit.sh'
    })
    expect(await backend.execute('/bin/bash scripts/emit.sh')).toMatchObject({
      output: 'same-root',
      exitCode: 0
    })
  })

  it('keeps Deep Agent file operations inside the existing sandbox root', async () => {
    const library = mkdtempSync(join(tmpdir(), 'refora-deep-agent-files-'))
    directories.push(library)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db'),
      trashItem: vi.fn(async () => undefined)
    })
    const paths = await sandboxService.ensure('workspace-a')
    const backend = await createReforaSandboxBackend({
      workspaceId: 'workspace-a',
      signal: new AbortController().signal,
      executionService: { execute: vi.fn() } as never,
      sandboxService
    })

    expect(await backend.write('/outputs/result.md', '# Result')).toMatchObject({
      path: '/outputs/result.md'
    })
    expect(readFileSync(join(paths.outputsRoot, 'result.md'), 'utf8')).toBe('# Result')
    const escaped = await backend.write('/../escape.md', 'blocked')
    expect(escaped).toHaveProperty('error')
    expect(existsSync(join(library, 'escape.md'))).toBe(false)
  })
})
