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
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'

export const AGENT_PYTHON_RUNTIME_VERSION = '0.2.0'

const UV_VERSION = '0.11.16'
const AGENT_PYTHON_VERSION = '3.12.13'
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
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
const EXPECTED_PACKAGES = {
  deepagents: '0.6.12',
  langchain: '1.3.14',
  'langchain-core': '1.5.1',
  langgraph: '1.2.9',
  'langchain-openai': '1.4.1',
  'langgraph-checkpoint-sqlite': '3.1.0'
} as const

interface AgentPythonManifest {
  runtimeVersion: string
  architecture: 'arm64' | 'x64'
  pythonVersion: string
  pythonRelativePath: string
  lockSha256: string
  packages: Record<string, string>
  installedAt: number
}

interface AgentPythonRuntimeDeps {
  userDataDir: string
  workerScriptPath: string
  projectPath: string
  environment?: NodeJS.ProcessEnv
  architecture?: 'arm64' | 'x64'
  downloadFile: (url: string, destination: string, signal: AbortSignal) => Promise<void>
}

interface RunFileOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
  timeoutMs?: number
}

export interface AgentPythonProviderConfig {
  model: string
  baseUrl: string
  apiKey: string
  useResponsesApi: boolean
  modelKwargs: Record<string, unknown>
  reasoning?: { effort: string; summary: 'auto' }
  temperature: number | null
  maxTokens: number | null
}

export interface AgentPythonToolSpec {
  name: string
  description: string
  schema: Record<string, unknown>
}

export interface AgentPythonRequest {
  mode: 'run' | 'resume'
  threadId: string
  workspaceId: string | null
  checkpointPath: string
  checkpointBefore: string | null
  provider: AgentPythonProviderConfig
  systemPrompt: string
  messages?: Array<Record<string, unknown>>
  decisions?: Array<Record<string, unknown>>
  tools: AgentPythonToolSpec[]
  readOnlyToolNames: string[]
  academicToolNames: string[]
  sandboxRoot: string | null
  memories: Record<string, string>
  includeResearchMemory: boolean
  recursionLimit: number
}

export interface AgentPythonEvent {
  event: string
  name?: string
  run_id?: string
  parent_ids?: string[]
  data?: Record<string, unknown>
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface AgentPythonCompletion {
  result: unknown
  state: Record<string, unknown>
}

interface AgentPythonStreamOptions {
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    toolCallId: string | null
  ) => Promise<string>
  onComplete: (completion: AgentPythonCompletion) => void
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
  if (options.signal.aborted) return Promise.reject(cancelled())
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
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
      finish(() => reject(new Error('Agent Python runtime setup timed out')))
    }, options.timeoutMs ?? INSTALL_TIMEOUT_MS)
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
        reject(new Error(
          stderr.trim() || stdout.trim() || `Agent Python setup exited with ${code ?? signal}`
        ))
        return
      }
      resolve(stdout.trim())
    }))
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

function samePackages(packages: Record<string, string>): boolean {
  return Object.entries(EXPECTED_PACKAGES).every(([name, version]) => packages[name] === version)
}

export function createAgentPythonRuntime(deps: AgentPythonRuntimeDeps) {
  const architecture = deps.architecture ?? (process.arch === 'x64' ? 'x64' : 'arm64')
  const root = join(
    deps.userDataDir,
    'agent-python',
    AGENT_PYTHON_RUNTIME_VERSION,
    `darwin-${architecture}`
  )
  const manifestPath = join(root, 'installed-manifest.json')
  const lockPath = join(dirname(deps.projectPath), 'uv.lock')
  const lifecycleController = new AbortController()
  let installPromise: Promise<string> | null = null

  function environment(): NodeJS.ProcessEnv {
    return {
      ...deps.environment,
      PATH: '/usr/bin:/bin',
      HOME: join(root, 'home'),
      UV_CACHE_DIR: join(root, 'cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: join(root, 'runtime', 'python'),
      PYTHONNOUSERSITE: '1',
      PYTHONUTF8: '1',
      LANGGRAPH_STRICT_MSGPACK: 'true'
    }
  }

  async function readManifest(lockSha256: string): Promise<AgentPythonManifest | null> {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as AgentPythonManifest
      if (
        manifest.runtimeVersion !== AGENT_PYTHON_RUNTIME_VERSION ||
        manifest.architecture !== architecture ||
        manifest.pythonVersion !== AGENT_PYTHON_VERSION ||
        manifest.lockSha256 !== lockSha256 ||
        !manifest.pythonRelativePath ||
        !samePackages(manifest.packages)
      ) {
        return null
      }
      return manifest
    } catch {
      return null
    }
  }

  async function installedPython(lockSha256: string): Promise<string | null> {
    const manifest = await readManifest(lockSha256)
    if (!manifest) return null
    const python = join(root, manifest.pythonRelativePath)
    return (await executable(python)) ? python : null
  }

  function startInstall(): Promise<string> {
    const installSignal = AbortSignal.any([
      lifecycleController.signal,
      AbortSignal.timeout(INSTALL_TIMEOUT_MS)
    ])
    const operation = (async () => {
      const lockSha256 = await sha256(lockPath)
      const existing = await installedPython(lockSha256)
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
        await runFile(uvPath, [
          'python',
          'install',
          AGENT_PYTHON_VERSION,
          '--install-dir',
          pythonRoot
        ], {
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
        const lockedRequirements = join(downloadRoot, 'requirements.lock')
        await runFile(uvPath, [
          'export',
          '--locked',
          '--no-dev',
          '--no-emit-project',
          '--format',
          'requirements.txt',
          '--project',
          dirname(deps.projectPath),
          '--output-file',
          lockedRequirements
        ], {
          cwd: root,
          env: environment(),
          signal: installSignal
        })
        await runFile(uvPath, [
          'pip',
          'install',
          '--python',
          python,
          '--upgrade',
          '--only-binary',
          ':all:',
          '--require-hashes',
          '--requirements',
          lockedRequirements
        ], {
          cwd: root,
          env: environment(),
          signal: installSignal
        })
        const packageScript =
          'import importlib.metadata,json,platform; print(json.dumps({"python":platform.python_version(),"packages":{' +
          Object.keys(EXPECTED_PACKAGES)
            .map((name) => `${JSON.stringify(name)}:importlib.metadata.version(${JSON.stringify(name)})`)
            .join(',') +
          '}}))'
        const reportedText = await runFile(python, ['-I', '-c', packageScript], {
          cwd: root,
          env: environment(),
          signal: installSignal,
          timeoutMs: 30_000
        })
        const reported = JSON.parse(reportedText) as {
          python?: unknown
          packages?: Record<string, string>
        }
        const packages = reported.packages ?? {}
        if (reported.python !== AGENT_PYTHON_VERSION) {
          throw new Error(`Installed Agent Python reported an unexpected version: ${reportedText}`)
        }
        if (!samePackages(packages)) {
          throw new Error(`Installed Agent Python packages reported unexpected versions: ${reportedText}`)
        }
        const manifest: AgentPythonManifest = {
          runtimeVersion: AGENT_PYTHON_RUNTIME_VERSION,
          architecture,
          pythonVersion: AGENT_PYTHON_VERSION,
          pythonRelativePath: 'runtime/venv/bin/python',
          lockSha256,
          packages,
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

  async function *stream(
    request: AgentPythonRequest,
    options: AgentPythonStreamOptions,
    signal: AbortSignal
  ): AsyncGenerator<AgentPythonEvent> {
    const python = await install(signal)
    if (signal.aborted) throw cancelled()
    const child = spawn(python, ['-I', '-u', deps.workerScriptPath], {
      cwd: root,
      env: environment(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, closeSignal) => resolve({ code, signal: closeSignal }))
      }
    )
    let stderr = ''
    let completed = false
    const abort = (): void => terminate(child)
    signal.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1_000_000)
    })
    child.stdin.on('error', () => undefined)
    child.stdin.write(`${JSON.stringify(request)}\n`)
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (signal.aborted) throw cancelled()
        if (!line.trim()) continue
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          throw new Error(`Agent Python worker returned invalid JSON: ${line.slice(0, 500)}`)
        }
        if (message.type === 'event') {
          if (message.event && typeof message.event === 'object') {
            yield message.event as AgentPythonEvent
          }
          continue
        }
        if (message.type === 'tool_request') {
          const id = typeof message.id === 'string' ? message.id : ''
          const name = typeof message.name === 'string' ? message.name : ''
          const args = message.arguments && typeof message.arguments === 'object' &&
            !Array.isArray(message.arguments)
            ? message.arguments as Record<string, unknown>
            : {}
          const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : null
          try {
            const result = await options.executeTool(name, args, toolCallId)
            if (signal.aborted) throw cancelled()
            child.stdin.write(`${JSON.stringify({ type: 'tool_response', id, ok: true, result })}\n`)
          } catch (error) {
            if (signal.aborted) throw cancelled()
            child.stdin.write(`${JSON.stringify({
              type: 'tool_response',
              id,
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            })}\n`)
          }
          continue
        }
        if (message.type === 'complete') {
          const state = message.state && typeof message.state === 'object'
            ? message.state as Record<string, unknown>
            : {}
          options.onComplete({ result: message.result, state })
          completed = true
          continue
        }
        if (message.type === 'error') {
          const error = message.error && typeof message.error === 'object'
            ? message.error as Record<string, unknown>
            : {}
          const failure = new Error(
            typeof error.message === 'string' ? error.message : 'Agent Python worker failed'
          )
          if (typeof error.name === 'string') failure.name = error.name
          throw failure
        }
      }
      const exit = await exitPromise
      if (signal.aborted) throw cancelled()
      if (!completed || exit.code !== 0) {
        throw new Error(
          stderr.trim() ||
          `Agent Python worker exited with ${exit.code ?? exit.signal ?? 'no completion'}`
        )
      }
    } finally {
      signal.removeEventListener('abort', abort)
      lines.close()
      if (!child.killed && child.exitCode === null) terminate(child)
    }
  }

  function destroy(): void {
    lifecycleController.abort()
  }

  return { install, stream, destroy }
}

export type AgentPythonRuntime = ReturnType<typeof createAgentPythonRuntime>
