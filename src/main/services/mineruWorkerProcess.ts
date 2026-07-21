import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { OcrJobStage, OcrProfile } from '../../shared/mineru-types'
import { MINERU_VERSION, MINERU_WORKER_PROTOCOL_VERSION } from '../../shared/mineru-types'
import type { MineruEngineManager } from './mineruEngineManager'
import { logger } from './logger'

interface MineruWorkerProcessDeps {
  engineManager: MineruEngineManager
  workerScriptPath: string
  idleTimeoutMs?: number
  requestTimeoutMs?: number
}

interface WorkerProgress {
  stage: OcrJobStage
  progress: number | null
}

interface ParseResult {
  markdown: string
  blocks: string
  middle: string
  assets: string | null
  pageCount: number | null
  blockCount: number
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (progress: WorkerProgress) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerResponse {
  id?: string | null
  result?: unknown
  error?: { code?: string; message?: string }
  event?: string
  requestId?: string
  stage?: OcrJobStage
  progress?: number | null
}

export function createMineruWorkerProcess(deps: MineruWorkerProcessDeps) {
  const pending = new Map<string, PendingRequest>()
  const idleTimeoutMs = deps.idleTimeoutMs ?? 5 * 60_000
  const requestTimeoutMs = deps.requestTimeoutMs ?? 2 * 60 * 60_000
  let child: ChildProcessWithoutNullStreams | null = null
  let startup: Promise<void> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let activeParseId: string | null = null
  let parseInFlight = false
  let cancelRequested = false
  let stopping = false
  let destroyed = false

  function clearIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
  }

  function rejectPending(error: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    activeParseId = null
  }

  function terminate(signal: NodeJS.Signals = 'SIGTERM'): void {
    const current = child
    if (!current) return
    if (current.pid) {
      try {
        process.kill(-current.pid, signal)
      } catch {
        current.kill(signal)
      }
    }
  }

  function handleMessage(message: WorkerResponse): void {
    if (message.event === 'progress' && message.requestId) {
      const request = pending.get(message.requestId)
      if (request?.onProgress && message.stage) {
        request.onProgress({ stage: message.stage, progress: message.progress ?? null })
      }
      return
    }
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.id === activeParseId) activeParseId = null
    if (message.error) {
      const error = new Error(message.error.message || 'MinerU worker request failed')
      error.name = message.error.code || 'MineruWorkerError'
      request.reject(error)
      return
    }
    request.resolve(message.result)
  }

  async function start(): Promise<void> {
    if (destroyed) throw new Error('MinerU worker is unavailable')
    if (child) return
    if (startup) return startup
    startup = (async () => {
      const runtime = await deps.engineManager.getRuntime()
      if (destroyed) throw new Error('MinerU worker is unavailable')
      stopping = false
      const spawned = spawn(runtime.pythonPath, ['-u', deps.workerScriptPath], {
        cwd: runtime.installPath,
        env: runtime.environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true
      })
      child = spawned
      const lines = createInterface({ input: spawned.stdout, crlfDelay: Infinity })
      lines.on('line', (line) => {
        try {
          handleMessage(JSON.parse(line) as WorkerResponse)
        } catch {
          logger.warn('mineru:worker emitted an invalid JSONL message')
        }
      })
      spawned.stderr.on('data', (chunk: Buffer) => {
        const message = chunk.toString('utf8').trim()
        if (message) logger.info(`mineru:worker ${message.slice(-4000)}`)
      })
      spawned.once('error', (error) => {
        const wasCurrent = child === spawned
        if (wasCurrent) child = null
        lines.close()
        if (wasCurrent) rejectPending(error)
      })
      spawned.once('close', (code, signal) => {
        const wasCurrent = child === spawned
        if (wasCurrent) child = null
        lines.close()
        if (wasCurrent) clearIdleTimer()
        if (!stopping && wasCurrent) {
          rejectPending(new Error(`MinerU worker stopped unexpectedly (${code ?? signal})`))
        }
      })
      const hello = await sendRequest('hello', {}, 30_000) as {
        protocolVersion?: number
        mineruVersion?: string
      }
      if (
        hello.protocolVersion !== MINERU_WORKER_PROTOCOL_VERSION ||
        hello.mineruVersion !== MINERU_VERSION
      ) {
        terminate()
        throw new Error('MinerU worker protocol or version is incompatible')
      }
    })()
    try {
      await startup
    } finally {
      startup = null
    }
  }

  function sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = requestTimeoutMs,
    onProgress?: (progress: WorkerProgress) => void
  ): Promise<unknown> {
    const current = child
    if (!current || current.stdin.destroyed) return Promise.reject(new Error('MinerU worker is unavailable'))
    const id = randomUUID()
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        if (activeParseId === id) activeParseId = null
        reject(new Error(`MinerU worker request timed out: ${method}`))
        terminate()
      }, timeoutMs)
      pending.set(id, { resolve: resolvePromise, reject, onProgress, timer })
      current.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        clearTimeout(request.timer)
        request.reject(error)
      })
      if (method === 'parse') activeParseId = id
    })
  }

  function scheduleIdleShutdown(): void {
    clearIdleTimer()
    idleTimer = setTimeout(() => {
      void stop()
    }, idleTimeoutMs)
  }

  async function parse(
    inputPath: string,
    outputPath: string,
    profile: OcrProfile,
    onProgress: (progress: WorkerProgress) => void
  ): Promise<ParseResult> {
    if (parseInFlight) throw new Error('MinerU is already processing a document')
    parseInFlight = true
    cancelRequested = false
    clearIdleTimer()
    try {
      await start()
      if (cancelRequested) {
        await stop()
        throw new Error('MinerU conversion was cancelled')
      }
      return await sendRequest('parse', {
        inputPath,
        outputPath,
        profile,
        language: 'ch'
      }, requestTimeoutMs, onProgress) as ParseResult
    } finally {
      parseInFlight = false
      cancelRequested = false
      if (!destroyed) scheduleIdleShutdown()
    }
  }

  async function cancel(): Promise<void> {
    if (!parseInFlight) return
    cancelRequested = true
    stopping = true
    if (child) terminate()
    rejectPending(new Error('MinerU conversion was cancelled'))
    child = null
    stopping = false
  }

  async function stop(): Promise<void> {
    clearIdleTimer()
    if (!child) return
    stopping = true
    try {
      await Promise.race([
        sendRequest('shutdown', {}, 5_000),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
      ]).catch(() => undefined)
    } finally {
      if (child) terminate()
      child = null
      rejectPending(new Error('MinerU worker stopped'))
      stopping = false
    }
  }

  function destroy(): void {
    clearIdleTimer()
    destroyed = true
    cancelRequested = true
    stopping = true
    terminate()
    child = null
    rejectPending(new Error('MinerU worker stopped'))
  }

  return { parse, cancel, stop, destroy }
}

export type MineruWorkerProcess = ReturnType<typeof createMineruWorkerProcess>
