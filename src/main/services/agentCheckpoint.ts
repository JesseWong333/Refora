import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { ACADEMIC_RESEARCH_TOOL_NAMES } from '../../shared/academicResearch'
import {
  ACADEMIC_ARTIFACT_MARKER_PREFIX,
  createAcademicCheckpointArtifactStore
} from './academicCheckpointArtifacts'

export const AGENT_STATE_VERSION = 2
export const ACADEMIC_CHECKPOINT_REDACTION =
  '[Academic research data omitted from persistent agent state]'

const academicToolNames = new Set<string>(ACADEMIC_RESEARCH_TOOL_NAMES)

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function academicToolName(value: Record<string, unknown>): string | null {
  if (typeof value.name === 'string' && academicToolNames.has(value.name)) return value.name
  const fn = record(value.function)
  return fn && typeof fn.name === 'string' && academicToolNames.has(fn.name)
    ? fn.name
    : null
}

function collectAcademicToolCallIds(value: unknown, ids: Set<string>, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  const valueRecord = record(value)
  if (valueRecord && academicToolName(valueRecord) && typeof valueRecord.id === 'string') {
    ids.add(valueRecord.id)
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    collectAcademicToolCallIds(item, ids, seen)
  }
}

export function sanitizeAcademicCheckpointValue(value: unknown): unknown {
  const academicToolCallIds = new Set<string>()
  collectAcademicToolCallIds(value, academicToolCallIds, new WeakSet())
  const seen = new WeakMap<object, unknown>()

  function sanitize(current: unknown): unknown {
    if (!current || typeof current !== 'object') return current
    const cached = seen.get(current)
    if (cached !== undefined) return cached
    if (Array.isArray(current)) {
      const output: unknown[] = []
      seen.set(current, output)
      output.push(...current.map(sanitize))
      return output
    }
    const input = current as Record<string, unknown>
    const output: Record<string, unknown> = {}
    seen.set(current, output)
    const toolName = academicToolName(input)
    const toolCallId = typeof input.tool_call_id === 'string' ? input.tool_call_id : null
    const isToolMessage =
      input.type === 'tool' ||
      input.type === 'tool_message' ||
      toolCallId !== null
    if (toolName && !isToolMessage) {
      for (const [key, item] of Object.entries(input)) {
        if (key === 'args' || key === 'input') output[key] = { omitted: true }
        else if (key === 'arguments') output[key] = JSON.stringify({ omitted: true })
        else if (key === 'output' || key === 'result') output[key] = ACADEMIC_CHECKPOINT_REDACTION
        else if (key === 'function' && record(item)) {
          output[key] = {
            ...(item as Record<string, unknown>),
            arguments: JSON.stringify({ omitted: true })
          }
        } else output[key] = sanitize(item)
      }
      return output
    }
    const messageName = typeof input.name === 'string' ? input.name : null
    const redactMessage =
      (messageName !== null && academicToolNames.has(messageName)) ||
      (toolCallId !== null && academicToolCallIds.has(toolCallId))
    for (const [key, item] of Object.entries(input)) {
      if (redactMessage && (key === 'content' || key === 'artifact')) {
        output[key] = key === 'content' ? ACADEMIC_CHECKPOINT_REDACTION : undefined
      } else {
        output[key] = sanitize(item)
      }
    }
    return output
  }

  return sanitize(value)
}

function withCheckpointDatabase<T>(
  path: string,
  operation: (database: Database.Database) => T
): T | null {
  try {
    const database = new Database(path)
    try {
      const exists = database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'checkpoints'")
        .get()
      return exists ? operation(database) : null
    } finally {
      database.close()
    }
  } catch {
    return null
  }
}

export function createAgentCheckpointService(dbPath: string) {
  const checkpointDirectory = join(dirname(dbPath), '.refora-agent', 'shared')
  const researchFrontierDirectory = join(checkpointDirectory, 'research-frontiers')
  mkdirSync(checkpointDirectory, { recursive: true, mode: 0o700 })
  void Promise.all([
    rm(join(checkpointDirectory, 'run-features'), { recursive: true, force: true }),
    rm(join(checkpointDirectory, 'thread-features'), { recursive: true, force: true })
  ]).catch(() => undefined)
  const checkpointPath = join(checkpointDirectory, 'checkpoints-python.sqlite')
  const legacyCheckpointPath = join(checkpointDirectory, 'checkpoints.sqlite')
  const artifactStore = createAcademicCheckpointArtifactStore(
    join(checkpointDirectory, 'academic-artifacts')
  )

  function artifactIdsInDatabase(path: string, threadId?: string): Set<string> {
    return withCheckpointDatabase(path, (database) => {
      const rows = threadId === undefined
        ? database.prepare(`
            SELECT checkpoint AS value FROM checkpoints
            UNION ALL
            SELECT metadata AS value FROM checkpoints
            UNION ALL
            SELECT value FROM writes
          `).all() as Array<{ value?: unknown }>
        : database.prepare(`
            SELECT checkpoint AS value FROM checkpoints WHERE thread_id = ?
            UNION ALL
            SELECT metadata AS value FROM checkpoints WHERE thread_id = ?
            UNION ALL
            SELECT value FROM writes WHERE thread_id = ?
          `).all(threadId, threadId, threadId) as Array<{ value?: unknown }>
      const ids = new Set<string>()
      const expression = new RegExp(
        `${ACADEMIC_ARTIFACT_MARKER_PREFIX}([a-f0-9]{64})`,
        'g'
      )
      for (const row of rows) {
        const value = row.value
        const text = typeof value === 'string'
          ? value
          : value instanceof Uint8Array
            ? Buffer.from(value).toString('utf8')
            : ''
        for (const match of text.matchAll(expression)) ids.add(match[1])
      }
      return ids
    }) ?? new Set()
  }

  function referencedArtifactIds(): Set<string> {
    return new Set([
      ...artifactIdsInDatabase(checkpointPath),
      ...artifactIdsInDatabase(legacyCheckpointPath)
    ])
  }

  async function getHead(threadId: string): Promise<string | null> {
    const row = withCheckpointDatabase(
      checkpointPath,
      (database) => database.prepare(`
        SELECT checkpoint_id AS checkpointId
        FROM checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ''
        ORDER BY checkpoint_id DESC
        LIMIT 1
      `).get(threadId) as { checkpointId?: unknown } | undefined
    )
    return row && typeof row.checkpointId === 'string' ? row.checkpointId : null
  }

  async function deleteFrom(path: string, threadId: string): Promise<void> {
    withCheckpointDatabase(path, (database) => {
      const transaction = database.transaction(() => {
        database.prepare('DELETE FROM writes WHERE thread_id = ?').run(threadId)
        database.prepare('DELETE FROM checkpoints WHERE thread_id = ?').run(threadId)
      })
      transaction()
    })
  }

  async function deleteThread(threadId: string): Promise<void> {
    const candidates = new Set([
      ...artifactIdsInDatabase(checkpointPath, threadId),
      ...artifactIdsInDatabase(legacyCheckpointPath, threadId)
    ])
    await Promise.all([
      deleteFrom(checkpointPath, threadId),
      deleteFrom(legacyCheckpointPath, threadId)
    ])
    await artifactStore.deleteUnreferenced(candidates, referencedArtifactIds())
  }

  async function pruneAcademicArtifacts(options?: {
    maxBytes?: number
    orphanAgeMs?: number
  }) {
    return artifactStore.prune(referencedArtifactIds(), options)
  }

  function close(): void {
    return
  }

  return {
    checkpointPath,
    researchFrontierDirectory,
    getHead,
    pruneAcademicArtifacts,
    deleteThread,
    close
  }
}

export type AgentCheckpointService = ReturnType<typeof createAgentCheckpointService>
