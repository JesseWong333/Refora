import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type {
  WebSearchRequest,
  WebSearchResultItem
} from '../../shared/webSearch'

export const DDGS_VERSION = '9.14.4'

const UV_VERSION = '0.11.16'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const SEARCH_TIMEOUT_MS = 20_000
const UV_RELEASES = {
  arm64: {
    archive: 'uv-aarch64-apple-darwin.tar.gz',
    sha256: '2b25be1af546be330b340b0a76b99f989daa6d92678fdffb87438e661e9d88fb'
  },
  x64: {
    archive: 'uv-x86_64-apple-darwin.tar.gz',
    sha256: '6b91ae3de155f51bd1f5b74814821c79f016a176561f252cd9ddfb976939af2e'
  }
} as const

interface DdgsManifest {
  ddgsVersion: string
  architecture: 'arm64' | 'x64'
  pythonRelativePath: string
  installedAt: number
}

export interface DdgsRuntimeStatus {
  installed: boolean
  version: string
}

interface DdgsRuntimeManagerDeps {
  userDataDir: string
  workerScriptPath: string
  environment?: NodeJS.ProcessEnv
  architecture?: 'arm64' | 'x64'
  downloadFile: (url: string, destination: string, signal: AbortSignal) => Promise<void>
}

interface RunFileOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  input?: string
  timeoutMs?: number
}

function executable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(() => true, () => false)
}

function terminate(child: ChildProcess): void {
  if (!child.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

function cancelled(): DOMException {
  return new DOMException('Cancelled', 'AbortError')
}

function waitForSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    let completed = false
    const finish = (callback: () => void): void => {
      if (completed) return
      completed = true
      signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => finish(() => reject(cancelled()))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error))
    )
  })
}

function runFile(command: string, args: string[], options: RunFileOptions): Promise<string> {
  if (options.signal.aborted) {
    return Promise.reject(cancelled())
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let completed = false
    const append = (current: string, chunk: Buffer): string =>
      `${current}${chunk.toString('utf8')}`.slice(-1_000_000)
    const finish = (callback: () => void): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
      callback()
    }
    const abort = (): void => {
      terminate(child)
      finish(() => reject(cancelled()))
    }
    const timer = setTimeout(() => {
      terminate(child)
      finish(() => reject(new Error('DDGS process timed out')))
    }, options.timeoutMs ?? 10 * 60 * 1000)
    options.signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('close', (code, signal) => finish(() => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `DDGS process exited with ${code ?? signal}`))
        return
      }
      resolve(stdout.trim())
    }))
    child.stdin.end(options.input ?? '')
  })
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

async function managedPython(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries.sort((left, right) => right.name.localeCompare(left.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    for (const name of ['python3.12', 'python3', 'python']) {
      const candidate = join(root, entry.name, 'bin', name)
      if (await executable(candidate)) return candidate
    }
  }
  return null
}

export function createDdgsRuntimeManager(deps: DdgsRuntimeManagerDeps) {
  const architecture = deps.architecture ?? (process.arch === 'x64' ? 'x64' : 'arm64')
  const root = join(
    deps.userDataDir,
    'web-search',
    'ddgs',
    DDGS_VERSION,
    `darwin-${architecture}`
  )
  const manifestPath = join(root, 'installed-manifest.json')
  const lifecycleController = new AbortController()
  let installPromise: Promise<string> | null = null

  function environment(): NodeJS.ProcessEnv {
    return {
      ...deps.environment,
      PATH: '/usr/bin:/bin',
      HOME: join(root, 'home'),
      UV_CACHE_DIR: join(root, 'cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: join(root, 'runtime', 'python'),
      PYTHONNOUSERSITE: '1'
    }
  }

  async function readManifest(): Promise<DdgsManifest | null> {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DdgsManifest
      if (
        manifest.ddgsVersion !== DDGS_VERSION ||
        manifest.architecture !== architecture ||
        !manifest.pythonRelativePath
      ) {
        return null
      }
      return manifest
    } catch {
      return null
    }
  }

  async function installedPython(): Promise<string | null> {
    const manifest = await readManifest()
    if (!manifest) return null
    const python = join(root, manifest.pythonRelativePath)
    return (await executable(python)) ? python : null
  }

  async function getStatus(): Promise<DdgsRuntimeStatus> {
    return {
      installed: Boolean(await installedPython()),
      version: DDGS_VERSION
    }
  }

  function startInstall(): Promise<string> {
    const installSignal = AbortSignal.any([
      lifecycleController.signal,
      AbortSignal.timeout(INSTALL_TIMEOUT_MS)
    ])
    const operation = (async () => {
      const existing = await installedPython()
      if (existing) return existing
      const release = UV_RELEASES[architecture]
      const downloadRoot = join(root, '.downloads')
      const archive = join(downloadRoot, release.archive)
      const extracted = join(downloadRoot, 'uv')
      const runtimeRoot = join(root, 'runtime')
      const pythonRoot = join(runtimeRoot, 'python')
      const venvRoot = join(runtimeRoot, 'venv')
      const uvPath = join(runtimeRoot, 'uv')
      try {
        await rm(root, { recursive: true, force: true })
        await Promise.all([
          mkdir(downloadRoot, { recursive: true, mode: 0o700 }),
          mkdir(join(root, 'home'), { recursive: true, mode: 0o700 }),
          mkdir(join(root, 'cache'), { recursive: true, mode: 0o700 }),
          mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
        ])
        await deps.downloadFile(
          `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${release.archive}`,
          archive,
          installSignal
        )
        if (await sha256(archive) !== release.sha256) {
          throw new Error('Downloaded uv runtime failed checksum verification')
        }
        await mkdir(extracted, { recursive: true, mode: 0o700 })
        await runFile('/usr/bin/tar', ['-xzf', archive, '--strip-components', '1', '-C', extracted], {
          cwd: root,
          env: { PATH: '/usr/bin:/bin' },
          signal: installSignal
        })
        await chmod(join(extracted, 'uv'), 0o755)
        await rename(join(extracted, 'uv'), uvPath)
        await runFile(uvPath, ['python', 'install', '3.12', '--install-dir', pythonRoot], {
          cwd: root,
          env: environment(),
          signal: installSignal
        })
        const managed = await managedPython(pythonRoot)
        if (!managed) throw new Error('Managed Python installation did not produce an executable')
        await runFile(uvPath, ['venv', '--python', managed, venvRoot], {
          cwd: root,
          env: environment(),
          signal: installSignal
        })
        const python = join(venvRoot, 'bin', 'python')
        await runFile(uvPath, [
          'pip',
          'install',
          '--python',
          python,
          '--upgrade',
          '--only-binary',
          ':all:',
          `ddgs==${DDGS_VERSION}`
        ], {
          cwd: root,
          env: environment(),
          signal: installSignal
        })
        const reported = await runFile(python, [
          '-I',
          '-c',
          'import importlib.metadata; print(importlib.metadata.version("ddgs"))'
        ], {
          cwd: root,
          env: environment(),
          signal: installSignal,
          timeoutMs: 30_000
        })
        if (reported.trim() !== DDGS_VERSION) {
          throw new Error(`Installed DDGS reported an unexpected version: ${reported}`)
        }
        const manifest: DdgsManifest = {
          ddgsVersion: DDGS_VERSION,
          architecture,
          pythonRelativePath: 'runtime/venv/bin/python',
          installedAt: Date.now()
        }
        const temporaryManifest = `${manifestPath}.tmp-${randomUUID()}`
        await writeFile(temporaryManifest, JSON.stringify(manifest, null, 2), { mode: 0o600 })
        await rename(temporaryManifest, manifestPath)
        await rm(downloadRoot, { recursive: true, force: true })
        return python
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
    })().finally(() => {
      if (installPromise === operation) installPromise = null
    })
    installPromise = operation
    void operation.catch(() => undefined)
    return operation
  }

  function install(signal: AbortSignal): Promise<string> {
    if (lifecycleController.signal.aborted || signal.aborted) {
      return Promise.reject(cancelled())
    }
    return waitForSignal(installPromise ?? startInstall(), signal)
  }

  async function search(
    request: Required<Pick<WebSearchRequest, 'query' | 'maxResults'>> &
      Pick<WebSearchRequest, 'timeRange' | 'region'> & { proxy?: string },
    signal: AbortSignal
  ): Promise<WebSearchResultItem[]> {
    const python = await install(signal)
    const output = await runFile(python, ['-I', '-u', deps.workerScriptPath], {
      cwd: root,
      env: environment(),
      signal,
      timeoutMs: SEARCH_TIMEOUT_MS,
      input: JSON.stringify(request)
    })
    const parsed = JSON.parse(output) as unknown
    if (!Array.isArray(parsed)) throw new Error('DDGS returned an invalid response')
    return parsed as WebSearchResultItem[]
  }

  function destroy(): void {
    lifecycleController.abort()
  }

  return { getStatus, install, search, destroy }
}

export type DdgsRuntimeManager = ReturnType<typeof createDdgsRuntimeManager>
