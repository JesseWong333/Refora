import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createDdgsRuntimeManager,
  DDGS_VERSION
} from '../../src/main/services/ddgsRuntime'

describe('DDGS runtime manager', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function fixture(
    installed: boolean,
    downloadFile = vi.fn()
  ) {
    const userDataDir = await mkdtemp(join(tmpdir(), 'refora-ddgs-test-'))
    roots.push(userDataDir)
    const root = join(
      userDataDir,
      'web-search',
      'ddgs',
      DDGS_VERSION,
      'darwin-arm64'
    )
    const workerScriptPath = join(userDataDir, 'ddgs_worker.py')
    await writeFile(workerScriptPath, '')
    if (installed) {
      const python = join(root, 'runtime', 'venv', 'bin', 'python')
      await mkdir(join(root, 'runtime', 'venv', 'bin'), { recursive: true })
      await writeFile(
        python,
        '#!/bin/sh\ncat >/dev/null\nprintf \'[{"title":"Result","url":"https://example.com","snippet":"Evidence"}]\'\n'
      )
      await chmod(python, 0o755)
      await writeFile(join(root, 'installed-manifest.json'), JSON.stringify({
        ddgsVersion: DDGS_VERSION,
        architecture: 'arm64',
        pythonRelativePath: 'runtime/venv/bin/python',
        installedAt: 1
      }))
    }
    return createDdgsRuntimeManager({
      userDataDir,
      workerScriptPath,
      architecture: 'arm64',
      downloadFile
    })
  }

  it('reports a missing managed runtime without downloading anything', async () => {
    const manager = await fixture(false)
    await expect(manager.getStatus()).resolves.toEqual({
      installed: false,
      version: DDGS_VERSION
    })
  })

  it('runs the isolated worker from a valid managed runtime', async () => {
    const manager = await fixture(true)
    await expect(manager.getStatus()).resolves.toEqual({
      installed: true,
      version: DDGS_VERSION
    })

    await expect(manager.search({
      query: 'test',
      maxResults: 1,
      region: 'us-en'
    }, new AbortController().signal)).resolves.toEqual([
      {
        title: 'Result',
        url: 'https://example.com',
        snippet: 'Evidence'
      }
    ])
  })

  it('lets callers cancel their own wait without cancelling a shared install', async () => {
    let installSignal: AbortSignal | undefined
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const downloadFile = vi.fn((
      _url: string,
      _destination: string,
      signal: AbortSignal
    ) => new Promise<void>((_resolve, reject) => {
      installSignal = signal
      notifyStarted?.()
      signal.addEventListener(
        'abort',
        () => reject(new DOMException('Cancelled', 'AbortError')),
        { once: true }
      )
    }))
    const manager = await fixture(false, downloadFile)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = manager.install(firstController.signal)
    await started
    const second = manager.install(secondController.signal)

    secondController.abort()
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(installSignal?.aborted).toBe(false)

    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(installSignal?.aborted).toBe(false)
    expect(downloadFile).toHaveBeenCalledTimes(1)

    manager.destroy()
    expect(installSignal?.aborted).toBe(true)
  })
})
