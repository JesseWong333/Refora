import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentRuntimeManager } from '../../src/main/services/agentRuntimeManager'
import { createAgentSandboxService } from '../../src/main/services/agentSandbox'

describe('agent runtime manager', () => {
  const directories: string[] = []

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  function setup(approved = true) {
    const library = mkdtempSync(join(tmpdir(), 'refora-agent-runtime-'))
    directories.push(library)
    const python = join(library, 'python')
    const node = join(library, 'node')
    const tool = join(library, 'tool')
    writeFileSync(python, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "Python 3.12.9"; else printf "%s" "$*"; fi\n')
    writeFileSync(node, '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "v24.18.0"; else printf "%s" "$*"; fi\n')
    writeFileSync(tool, '#!/bin/sh\nprintf "%s" "$*"\n')
    chmodSync(python, 0o755)
    chmodSync(node, 0o755)
    chmodSync(tool, 0o755)
    const sandboxService = createAgentSandboxService({
      repos: { settings: { get: () => library } } as never,
      dbPath: join(library, 'refora.db')
    })
    const confirmInstall = vi.fn(async () => approved)
    const manager = createAgentRuntimeManager({
      sandboxService,
      confirmInstall,
      environment: {
        PATH: '',
        REFORA_AGENT_PYTHON: python,
        REFORA_AGENT_NODE: node,
        REFORA_AGENT_UV: tool,
        REFORA_AGENT_PNPM: tool
      }
    })
    return { library, sandboxService, manager, confirmInstall }
  }

  it('creates lightweight project declarations and uses shared package stores', async () => {
    const { sandboxService, manager, confirmInstall } = setup()
    const result = await manager.installPackages(
      'workspace-a',
      [{ name: 'pandas', version: '2.3.1' }],
      [{ name: 'papaparse', version: '5.5.3' }],
      ['python', 'node']
    )
    const paths = sandboxService.paths('workspace-a')

    expect(confirmInstall).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      runtimes: ['python', 'node'],
      python: ['pandas==2.3.1'],
      node: ['papaparse@5.5.3']
    })
    expect(result.output[0]).toContain('add --no-build --python')
    expect(result.output[1]).toContain(`--store-dir ${paths.pnpmStore}`)
    expect(readFileSync(join(paths.sandboxRoot, 'pyproject.toml'), 'utf8')).toContain('>=3.12,<3.13')
    expect(readFileSync(join(paths.sandboxRoot, 'package.json'), 'utf8')).toContain('"private": true')
    expect(existsSync(join(paths.sandboxRoot, 'inputs'))).toBe(false)
  })

  it('rejects unsafe package specifications before approval', async () => {
    const { manager, confirmInstall } = setup()
    await expect(manager.installPackages(null, [{ name: 'safe; touch bad' }], [], [])).rejects.toThrow('Invalid python package name')
    expect(confirmInstall).not.toHaveBeenCalled()
  })

  it('does not install when approval is declined', async () => {
    const { manager } = setup(false)
    await expect(manager.installPackages(null, [], [], ['python'])).rejects.toThrow('not approved')
  })
})
