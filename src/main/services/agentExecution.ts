import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import type { AgentExecutionChangedFile, AgentExecutionResult } from '../../shared/ipc-types'
import type { AgentSandboxPaths, AgentSandboxService } from './agentSandbox'
import type { AgentDatabaseSnapshotService } from './agentDatabaseSnapshot'
import type { AgentReadonlyFilesService } from './agentReadonlyFiles'
import type { AgentRuntimeManager } from './agentRuntimeManager'
import { workspaceAssetMediaType } from './workspaceAssets'

const DEFAULT_TIMEOUT_SECONDS = 60
const MAX_TIMEOUT_SECONDS = 300
const OUTPUT_LIMIT = 256 * 1024
const MAX_CHANGED_FILES = 200

interface AgentRunnerRequest {
  script: string
  cwd: string
  environment: Record<string, string>
  timeoutMs: number
  sandboxRoot: string
  readOnlyPaths: string[]
  signal?: AbortSignal
}

export interface AgentRunner {
  run(request: AgentRunnerRequest): Promise<Omit<AgentExecutionResult, 'changedFiles'>>
}

function appendLimited(current: Buffer[], size: number, chunk: Buffer): { size: number; truncated: boolean } {
  if (size >= OUTPUT_LIMIT) return { size, truncated: true }
  const remaining = OUTPUT_LIMIT - size
  const selected = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining)
  current.push(selected)
  return { size: size + selected.length, truncated: selected.length !== chunk.length }
}

function terminateProcessGroup(pid: number | undefined): void {
  if (!pid) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        return
      }
    }
  }, 1000).unref()
}

export function createDirectAgentRunner(): AgentRunner {
  return {
    run: (request) => new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutSize = 0
      let stderrSize = 0
      let truncated = false
      let timedOut = false
      let completed = false
      const child = spawn('/bin/bash', ['--noprofile', '--norc', '-o', 'pipefail', '-c', request.script], {
        cwd: request.cwd,
        env: request.environment,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const timer = setTimeout(() => {
        timedOut = true
        terminateProcessGroup(child.pid)
      }, request.timeoutMs)
      const abort = (): void => terminateProcessGroup(child.pid)
      request.signal?.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (raw: Buffer) => {
        const result = appendLimited(stdout, stdoutSize, raw)
        stdoutSize = result.size
        truncated ||= result.truncated
      })
      child.stderr.on('data', (raw: Buffer) => {
        const result = appendLimited(stderr, stderrSize, raw)
        stderrSize = result.size
        truncated ||= result.truncated
      })
      child.once('error', (error) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        reject(error)
      })
      child.once('close', (exitCode, signal) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', abort)
        resolve({
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          durationMs: Date.now() - startedAt,
          timedOut,
          truncated
        })
      })
    })
  }
}

export function createBrokerAgentRunner(brokerPath: string): AgentRunner {
  return {
    run: (request) => {
      if (!existsSync(brokerPath)) {
        return Promise.reject(new Error(`Agent execution broker is unavailable: ${brokerPath}`))
      }
      return new Promise((resolve, reject) => {
        const startedAt = Date.now()
        let timedOut = false
        let cancelled = false
        let completed = false
        const child = spawn(brokerPath, [], {
          cwd: request.cwd,
          env: { PATH: '/usr/bin:/bin' },
          shell: false,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe']
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        const timer = setTimeout(() => {
          timedOut = true
          terminateProcessGroup(child.pid)
        }, request.timeoutMs + 1000)
        const abort = (): void => {
          cancelled = true
          terminateProcessGroup(child.pid)
        }
        request.signal?.addEventListener('abort', abort, { once: true })
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        child.once('error', (error) => {
          if (completed) return
          completed = true
          clearTimeout(timer)
          request.signal?.removeEventListener('abort', abort)
          reject(error)
        })
        child.once('close', (code, signal) => {
          if (completed) return
          completed = true
          clearTimeout(timer)
          request.signal?.removeEventListener('abort', abort)
          if (cancelled) {
            reject(new DOMException('Cancelled', 'AbortError'))
            return
          }
          if (timedOut) {
            resolve({
              exitCode: code,
              signal,
              stdout: '',
              stderr: 'Command timed out',
              durationMs: Date.now() - startedAt,
              timedOut: true,
              truncated: false
            })
            return
          }
          const raw = Buffer.concat(stdout).toString('utf8')
          if (code !== 0) {
            reject(new Error(Buffer.concat(stderr).toString('utf8') || raw || `Agent broker exited with code ${code}`))
            return
          }
          try {
            const parsed = JSON.parse(raw) as Omit<AgentExecutionResult, 'changedFiles'>
            resolve({ ...parsed, durationMs: parsed.durationMs ?? Date.now() - startedAt, signal: parsed.signal ?? signal })
          } catch {
            reject(new Error(`Agent broker returned invalid output: ${raw.slice(0, 1000)}`))
          }
        })
        child.stdin.end(JSON.stringify({
          script: request.script,
          cwd: request.cwd,
          environment: request.environment,
          timeoutMs: request.timeoutMs,
          sandboxRoot: request.sandboxRoot,
          readOnlyPaths: request.readOnlyPaths
        }))
      })
    }
  }
}

interface AgentExecutionServiceDeps {
  sandboxService: AgentSandboxService
  snapshotService: AgentDatabaseSnapshotService
  readonlyFilesService: AgentReadonlyFilesService
  runtimeManager: AgentRuntimeManager
  runner: AgentRunner
}

interface AgentExecutionRequest {
  workspaceId?: string | null
  script: string
  cwd?: string
  timeoutSeconds?: number
  signal?: AbortSignal
}

interface FileSnapshot {
  mtimeMs: number
  size: number
}

async function snapshotFiles(paths: AgentSandboxPaths): Promise<Map<string, FileSnapshot>> {
  const result = new Map<string, FileSnapshot>()
  const roots = [paths.workRoot, paths.scriptsRoot, paths.outputsRoot]
  async function walk(root: string, current: string): Promise<void> {
    if (result.size >= MAX_CHANGED_FILES * 5) return
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = resolvePath(current, entry.name)
      if (entry.isDirectory()) {
        await walk(root, full)
      } else if (entry.isFile()) {
        const info = await stat(full)
        result.set(relative(paths.sandboxRoot, full), { mtimeMs: info.mtimeMs, size: info.size })
      }
    }
  }
  for (const root of roots) await walk(root, root)
  return result
}

function changedFiles(before: Map<string, FileSnapshot>, after: Map<string, FileSnapshot>): AgentExecutionChangedFile[] {
  const changed: AgentExecutionChangedFile[] = []
  for (const [path, current] of after) {
    const previous = before.get(path)
    if (!previous || previous.mtimeMs !== current.mtimeMs || previous.size !== current.size) {
      changed.push({ path, mimeType: workspaceAssetMediaType(path).mimeType, size: current.size })
    }
    if (changed.length >= MAX_CHANGED_FILES) break
  }
  return changed
}

function runtimeReadOnlyPaths(runtime: Awaited<ReturnType<AgentRuntimeManager['resolve']>>): string[] {
  const paths = new Set<string>()
  for (const executable of [runtime.pythonPath, runtime.nodePath, runtime.uvPath, runtime.pnpmPath]) {
    if (!executable) continue
    paths.add(executable)
    try {
      const resolved = realpathSync(executable)
      paths.add(resolved)
      paths.add(dirname(resolved))
      paths.add(dirname(dirname(resolved)))
    } catch {
      continue
    }
  }
  return [...paths]
}

export function createAgentExecutionService(deps: AgentExecutionServiceDeps) {
  const queues = new Map<string, Promise<unknown>>()
  let destroyed = false

  async function execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    if (destroyed) throw new Error('Agent execution service is unavailable')
    if (!request.script.trim()) throw new Error('Command script is empty')
    const key = request.workspaceId || 'default'
    const previous = queues.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    queues.set(key, queued)
    await previous.catch(() => undefined)
    try {
      if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      const paths = await deps.sandboxService.ensure(request.workspaceId)
      const [databaseSnapshot, readonly, runtime] = await Promise.all([
        deps.snapshotService.refresh(),
        deps.readonlyFilesService.writeManifest(),
        deps.runtimeManager.resolve(request.workspaceId)
      ])
      const cwd = request.cwd
        ? deps.sandboxService.resolveInside(request.workspaceId, request.cwd)
        : paths.workRoot
      const timeoutSeconds = Math.min(
        MAX_TIMEOUT_SECONDS,
        Math.max(1, Math.floor(request.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS))
      )
      const before = await snapshotFiles(paths)
      const execution = await deps.runner.run({
        script: request.script,
        cwd,
        timeoutMs: timeoutSeconds * 1000,
        sandboxRoot: paths.sandboxRoot,
        readOnlyPaths: [
          databaseSnapshot,
          readonly.manifestPath,
          paths.runtimeRoot,
          ...runtimeReadOnlyPaths(runtime),
          ...readonly.files.map((file) => file.sourcePath)
        ],
        signal: request.signal,
        environment: {
          HOME: paths.workRoot,
          TMPDIR: paths.tempRoot,
          PATH: runtime.path,
          PYTHONNOUSERSITE: '1',
          UV_CACHE_DIR: paths.uvStore,
          PNPM_STORE_DIR: paths.pnpmStore,
          REFORA_SANDBOX: paths.sandboxRoot,
          REFORA_WORK: paths.workRoot,
          REFORA_SCRIPTS: paths.scriptsRoot,
          REFORA_OUTPUTS: paths.outputsRoot,
          REFORA_DB: databaseSnapshot,
          REFORA_LIBRARY_MANIFEST: readonly.manifestPath,
          REFORA_ASSETS_MANIFEST: readonly.manifestPath,
          ...(runtime.pythonPath ? { REFORA_PYTHON: runtime.pythonPath } : {}),
          ...(runtime.nodePath ? { REFORA_NODE: runtime.nodePath } : {})
        }
      })
      const after = await snapshotFiles(paths)
      return { ...execution, changedFiles: changedFiles(before, after) }
    } finally {
      release?.()
      if (queues.get(key) === queued) queues.delete(key)
    }
  }

  function destroy(): void {
    destroyed = true
    queues.clear()
  }

  return { execute, destroy }
}

export type AgentExecutionService = ReturnType<typeof createAgentExecutionService>
