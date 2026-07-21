import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentExecutionService, createDirectAgentRunner } from '../../src/main/services/agentExecution'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'

describe('agent execution service', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  function setup() {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-execution-'))
    directories.push(library)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db')
    })
    const service = createAgentExecutionService({
      sandboxService,
      snapshotService: { refresh: async () => join(library, 'snapshot.db') },
      readonlyFilesService: {
        writeManifest: async () => ({ manifestPath: join(library, 'manifest.json'), files: [] })
      },
      runtimeManager: {
        resolve: async () => ({ pythonPath: null, nodePath: null, uvPath: null, pnpmPath: null, path: '/usr/bin:/bin' })
      },
      runner: createDirectAgentRunner()
    })
    return { sandboxService, service }
  }

  it('runs Bash in the workspace sandbox and reports generated files', async () => {
    const { service } = setup()
    const result = await service.execute({
      workspaceId: 'workspace-a',
      script: 'mkdir -p "$REFORA_OUTPUTS"; printf "a,b\\n1,2\\n" > "$REFORA_OUTPUTS/result.csv"; printf done'
    })

    expect(result).toMatchObject({ exitCode: 0, stdout: 'done', timedOut: false })
    expect(result.changedFiles).toEqual([
      expect.objectContaining({ path: 'outputs/result.csv', mimeType: 'text/csv' })
    ])
  })

  it('uses the default sandbox when no workspace is selected', async () => {
    const { service, sandboxService } = setup()
    const result = await service.execute({ script: 'printf %s "$REFORA_SANDBOX"' })
    expect(result.stdout).toBe(sandboxService.paths(null).sandboxRoot)
  })
})
