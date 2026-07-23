import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import type { SerializerProtocol } from '@langchain/langgraph-checkpoint'
import { isAIMessage, isBaseMessage, isToolMessage } from '@langchain/core/messages'
import { ACADEMIC_RESEARCH_TOOL_NAMES } from '../../shared/academicResearch'
import {
  ACADEMIC_ARTIFACT_MARKER_KEY,
  createAcademicCheckpointArtifactStore,
  type AcademicCheckpointArtifactStore
} from './academicCheckpointArtifacts'

export const AGENT_STATE_VERSION = 1
export const ACADEMIC_CHECKPOINT_REDACTION =
  '[Academic research data omitted from persistent agent state]'

const academicToolNames = new Set<string>(ACADEMIC_RESEARCH_TOOL_NAMES)

function objectRecord(value: unknown): Record<PropertyKey, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<PropertyKey, unknown>
    : null
}

function academicToolCallName(value: Record<PropertyKey, unknown>): string | null {
  if (typeof value.name === 'string' && academicToolNames.has(value.name)) return value.name
  const fn = objectRecord(value.function)
  return fn && typeof fn.name === 'string' && academicToolNames.has(fn.name)
    ? fn.name
    : null
}

function collectAcademicToolCallIds(value: unknown, ids: Set<string>, seen: WeakSet<object>): void {
  const record = objectRecord(value)
  if (!record || seen.has(record)) return
  seen.add(record)
  if (academicToolCallName(record) && typeof record.id === 'string') ids.add(record.id)
  for (const key of Reflect.ownKeys(record)) {
    collectAcademicToolCallIds(record[key], ids, seen)
  }
}

function cloneObject<T extends object>(value: T): T {
  const clone = Object.create(Object.getPrototypeOf(value)) as T
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor) Object.defineProperty(clone, key, descriptor)
  }
  return clone
}

export function sanitizeAcademicCheckpointValue(value: unknown): unknown {
  const academicToolCallIds = new Set<string>()
  collectAcademicToolCallIds(value, academicToolCallIds, new WeakSet())
  const seen = new WeakMap<object, unknown>()

  function sanitize(current: unknown): unknown {
    const record = objectRecord(current)
    if (!record) return current
    const existing = seen.get(record)
    if (existing !== undefined) return existing

    if (isToolMessage(current)) {
      const shouldRedact =
        (typeof current.name === 'string' && academicToolNames.has(current.name)) ||
        academicToolCallIds.has(current.tool_call_id)
      if (!shouldRedact) return current
      const clone = cloneObject(current)
      seen.set(record, clone)
      clone.content = ACADEMIC_CHECKPOINT_REDACTION
      clone.artifact = undefined
      clone.lc_kwargs = {
        ...clone.lc_kwargs,
        content: ACADEMIC_CHECKPOINT_REDACTION,
        artifact: undefined
      }
      return clone
    }

    if (Array.isArray(current)) {
      const clone: unknown[] = []
      seen.set(record, clone)
      let changed = false
      for (const item of current) {
        const next = sanitize(item)
        clone.push(next)
        changed ||= next !== item
      }
      if (!changed) {
        seen.set(record, current)
        return current
      }
      return clone
    }

    const toolName = academicToolCallName(record)
    if (toolName) {
      const clone = cloneObject(record)
      seen.set(record, clone)
      if ('args' in clone) clone.args = { omitted: true }
      if ('input' in clone) clone.input = { omitted: true }
      if ('arguments' in clone) clone.arguments = JSON.stringify({ omitted: true })
      if ('output' in clone) clone.output = ACADEMIC_CHECKPOINT_REDACTION
      if ('result' in clone) clone.result = ACADEMIC_CHECKPOINT_REDACTION
      const fn = objectRecord(clone.function)
      if (fn) {
        clone.function = {
          ...fn,
          arguments: JSON.stringify({ omitted: true })
        }
      }
      return clone
    }

    if (isBaseMessage(current) && isAIMessage(current)) {
      const clone = cloneObject(current)
      seen.set(record, clone)
      let changed = false
      for (const key of [
        'content',
        'tool_calls',
        'invalid_tool_calls',
        'additional_kwargs',
        'lc_kwargs'
      ]) {
        const before = clone[key as keyof typeof clone]
        const after = sanitize(before)
        if (after !== before) {
          Object.defineProperty(clone, key, {
            ...Object.getOwnPropertyDescriptor(clone, key),
            value: after
          })
          changed = true
        }
      }
      if (!changed) {
        seen.set(record, current)
        return current
      }
      return clone
    }

    const prototype = Object.getPrototypeOf(record)
    if (prototype !== Object.prototype && prototype !== null) return current
    const clone = cloneObject(record)
    seen.set(record, clone)
    let changed = false
    for (const key of Reflect.ownKeys(record)) {
      const before = record[key]
      const after = sanitize(before)
      if (after !== before) {
        Object.defineProperty(clone, key, {
          ...Object.getOwnPropertyDescriptor(clone, key),
          value: after
        })
        changed = true
      }
    }
    if (!changed) {
      seen.set(record, current)
      return current
    }
    return clone
  }

  return sanitize(value)
}

function academicMessageMarker(value: unknown): string | null {
  if (!isBaseMessage(value)) return null
  const responseMetadata = objectRecord(value.response_metadata)
  return typeof responseMetadata?.[ACADEMIC_ARTIFACT_MARKER_KEY] === 'string'
    ? responseMetadata[ACADEMIC_ARTIFACT_MARKER_KEY] as string
    : null
}

function withAcademicMessageMarker<T extends object>(value: T, marker: string): T {
  const clone = cloneObject(value)
  const record = clone as Record<PropertyKey, unknown>
  const responseMetadata = {
    ...(objectRecord(record.response_metadata) ?? {}),
    [ACADEMIC_ARTIFACT_MARKER_KEY]: marker
  }
  record.response_metadata = responseMetadata
  record.lc_kwargs = {
    ...(objectRecord(record.lc_kwargs) ?? {}),
    response_metadata: responseMetadata
  }
  return clone
}

function withoutAcademicMessageMarker<T extends object>(value: T): T {
  const clone = cloneObject(value)
  const record = clone as Record<PropertyKey, unknown>
  const responseMetadata = { ...(objectRecord(record.response_metadata) ?? {}) }
  delete responseMetadata[ACADEMIC_ARTIFACT_MARKER_KEY]
  record.response_metadata = responseMetadata
  record.lc_kwargs = {
    ...(objectRecord(record.lc_kwargs) ?? {}),
    response_metadata: responseMetadata
  }
  return clone
}

function academicArtifactWrapper(marker: string, fallback: unknown): Record<string, unknown> {
  return {
    [ACADEMIC_ARTIFACT_MARKER_KEY]: marker,
    fallback
  }
}

function wrapperMarker(value: unknown): string | null {
  const record = objectRecord(value)
  if (!record || !('fallback' in record)) return null
  return typeof record[ACADEMIC_ARTIFACT_MARKER_KEY] === 'string'
    ? record[ACADEMIC_ARTIFACT_MARKER_KEY] as string
    : null
}

async function externalizeAcademicCheckpointValue(
  value: unknown,
  delegate: SerializerProtocol,
  artifactStore: AcademicCheckpointArtifactStore
): Promise<unknown> {
  const academicToolCallIds = new Set<string>()
  collectAcademicToolCallIds(value, academicToolCallIds, new WeakSet())
  const seen = new WeakMap<object, Promise<unknown>>()

  async function storeValue(current: unknown): Promise<string> {
    const [type, data] = await delegate.dumpsTyped(current)
    return artifactStore.write(type, data)
  }

  async function visit(current: unknown): Promise<unknown> {
    const record = objectRecord(current)
    if (!record) return current
    const existing = seen.get(record)
    if (existing) return existing

    const pending = (async (): Promise<unknown> => {
      if (isToolMessage(current)) {
        const shouldExternalize =
          (typeof current.name === 'string' && academicToolNames.has(current.name)) ||
          academicToolCallIds.has(current.tool_call_id)
        if (!shouldExternalize) return current
        const marker = await storeValue(current)
        return withAcademicMessageMarker(
          sanitizeAcademicCheckpointValue(current) as typeof current,
          marker
        )
      }

      if (isBaseMessage(current) && isAIMessage(current)) {
        const sanitized = sanitizeAcademicCheckpointValue(current)
        if (sanitized === current) return current
        const marker = await storeValue(current)
        return withAcademicMessageMarker(sanitized as typeof current, marker)
      }

      if (academicToolCallName(record)) {
        const marker = await storeValue(current)
        return academicArtifactWrapper(marker, sanitizeAcademicCheckpointValue(current))
      }

      if (Array.isArray(current)) {
        const values = await Promise.all(current.map(visit))
        return values.some((item, index) => item !== current[index]) ? values : current
      }

      const prototype = Object.getPrototypeOf(record)
      if (prototype !== Object.prototype && prototype !== null) return current
      const clone = cloneObject(record)
      let changed = false
      for (const key of Reflect.ownKeys(record)) {
        const before = record[key]
        const after = await visit(before)
        if (after !== before) {
          Object.defineProperty(clone, key, {
            ...Object.getOwnPropertyDescriptor(clone, key),
            value: after
          })
          changed = true
        }
      }
      return changed ? clone : current
    })()
    seen.set(record, pending)
    return pending
  }

  return visit(value)
}

async function hydrateAcademicCheckpointValue(
  value: unknown,
  delegate: SerializerProtocol,
  artifactStore: AcademicCheckpointArtifactStore
): Promise<unknown> {
  const seen = new WeakMap<object, Promise<unknown>>()

  async function load(marker: string): Promise<unknown | null> {
    const stored = await artifactStore.read(marker)
    return stored ? delegate.loadsTyped(stored.type, stored.data) : null
  }

  async function visit(current: unknown): Promise<unknown> {
    const record = objectRecord(current)
    if (!record) return current
    const existing = seen.get(record)
    if (existing) return existing

    const pending = (async (): Promise<unknown> => {
      const messageMarker = academicMessageMarker(current)
      if (messageMarker && isBaseMessage(current)) {
        return await load(messageMarker) ?? withoutAcademicMessageMarker(current)
      }

      const marker = wrapperMarker(current)
      if (marker) return await load(marker) ?? await visit(record.fallback)

      if (Array.isArray(current)) {
        const values = await Promise.all(current.map(visit))
        return values.some((item, index) => item !== current[index]) ? values : current
      }

      const prototype = Object.getPrototypeOf(record)
      if (prototype !== Object.prototype && prototype !== null) return current
      const clone = cloneObject(record)
      let changed = false
      for (const key of Reflect.ownKeys(record)) {
        const before = record[key]
        const after = await visit(before)
        if (after !== before) {
          Object.defineProperty(clone, key, {
            ...Object.getOwnPropertyDescriptor(clone, key),
            value: after
          })
          changed = true
        }
      }
      return changed ? clone : current
    })()
    seen.set(record, pending)
    return pending
  }

  return visit(value)
}

export function createRecoverableAcademicCheckpointSerializer(
  delegate: SerializerProtocol,
  artifactStore: AcademicCheckpointArtifactStore
): SerializerProtocol {
  return {
    dumpsTyped: async (value) =>
      delegate.dumpsTyped(
        await externalizeAcademicCheckpointValue(value, delegate, artifactStore)
      ),
    loadsTyped: async (type, value) =>
      hydrateAcademicCheckpointValue(
        await delegate.loadsTyped(type, value),
        delegate,
        artifactStore
      )
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
  const checkpointPath = join(checkpointDirectory, 'checkpoints.sqlite')
  const checkpointer = SqliteSaver.fromConnString(checkpointPath)
  const artifactStore = createAcademicCheckpointArtifactStore(
    join(checkpointDirectory, 'academic-artifacts')
  )
  checkpointer.serde = createRecoverableAcademicCheckpointSerializer(
    checkpointer.serde,
    artifactStore
  )
  let closed = false

  function artifactIdsInDatabase(threadId?: string): Set<string> {
    const ids = new Set<string>()
    const rows = threadId === undefined
      ? checkpointer.db.prepare(`
          SELECT checkpoint AS value FROM checkpoints
          UNION ALL
          SELECT metadata AS value FROM checkpoints
          UNION ALL
          SELECT value FROM writes
        `).all() as Array<{ value?: unknown }>
      : checkpointer.db.prepare(`
          SELECT checkpoint AS value FROM checkpoints WHERE thread_id = ?
          UNION ALL
          SELECT metadata AS value FROM checkpoints WHERE thread_id = ?
          UNION ALL
          SELECT value FROM writes WHERE thread_id = ?
        `).all(threadId, threadId, threadId) as Array<{ value?: unknown }>
    const expression = /refora-academic-artifact:v1:([a-f0-9]{64})/g
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
  }

  async function ensureSetup(): Promise<void> {
    await checkpointer.getTuple({ configurable: { thread_id: '__refora_setup__' } })
  }

  async function getHead(threadId: string): Promise<string | null> {
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } })
    const checkpointId = tuple?.config?.configurable?.checkpoint_id
    return typeof checkpointId === 'string' ? checkpointId : null
  }

  async function pruneAcademicArtifacts(options?: {
    maxBytes?: number
    orphanAgeMs?: number
  }) {
    await ensureSetup()
    return artifactStore.prune(artifactIdsInDatabase(), options)
  }

  async function deleteThread(threadId: string): Promise<void> {
    if (closed) return
    await ensureSetup()
    const candidates = artifactIdsInDatabase(threadId)
    await checkpointer.deleteThread(threadId)
    await artifactStore.deleteUnreferenced(candidates, artifactIdsInDatabase())
  }

  function close(): void {
    if (closed) return
    closed = true
    checkpointer.db.close()
  }

  return {
    checkpointer,
    checkpointPath,
    researchFrontierDirectory,
    getHead,
    pruneAcademicArtifacts,
    deleteThread,
    close
  }
}

export type AgentCheckpointService = ReturnType<typeof createAgentCheckpointService>
