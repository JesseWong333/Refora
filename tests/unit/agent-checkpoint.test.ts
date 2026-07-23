import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph-checkpoint'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACADEMIC_CHECKPOINT_REDACTION,
  createAgentCheckpointService,
  createRecoverableAcademicCheckpointSerializer,
  sanitizeAcademicCheckpointValue
} from '../../src/main/services/agentCheckpoint'
import { createAcademicCheckpointArtifactStore } from '../../src/main/services/academicCheckpointArtifacts'

vi.mock('@langchain/langgraph-checkpoint-sqlite', () => {
  function threadId(config: unknown): string {
    if (!config || typeof config !== 'object') return ''
    const configurable = Reflect.get(config, 'configurable')
    if (!configurable || typeof configurable !== 'object') return ''
    const value = Reflect.get(configurable, 'thread_id')
    return typeof value === 'string' ? value : ''
  }

  class TestSqliteSaver {
    readonly rows = new Map<string, string[]>()
    serde = {
      dumpsTyped: async (value: unknown): Promise<[string, Uint8Array]> => [
        'json',
        new TextEncoder().encode(JSON.stringify(value))
      ],
      loadsTyped: async (_type: string, value: string | Uint8Array): Promise<unknown> =>
        JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value))
    }
    db = {
      prepare: (sql: string) => ({
        all: (...parameters: unknown[]) => {
          const selected = sql.includes('WHERE thread_id = ?')
            ? [this.rows.get(String(parameters[0])) ?? []]
            : [...this.rows.values()]
          return selected.flatMap((values) => values.map((value) => ({ value })))
        }
      }),
      close: () => undefined
    }

    static fromConnString(): TestSqliteSaver {
      return new TestSqliteSaver()
    }

    async getTuple(): Promise<undefined> {
      return undefined
    }

    async put(config: unknown, checkpoint: unknown, metadata: unknown): Promise<unknown> {
      const [, checkpointData] = await this.serde.dumpsTyped(checkpoint)
      const [, metadataData] = await this.serde.dumpsTyped(metadata)
      this.rows.set(threadId(config), [
        new TextDecoder().decode(checkpointData),
        new TextDecoder().decode(metadataData)
      ])
      return config
    }

    async deleteThread(value: string): Promise<void> {
      this.rows.delete(value)
    }
  }

  return { SqliteSaver: TestSqliteSaver }
})

describe('createAgentCheckpointService', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-agent-checkpoint-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('redacts academic tool arguments and results before checkpoint persistence', async () => {
    const sanitized = sanitizeAcademicCheckpointValue({
      messages: [
        new AIMessage({
          content: [{
            type: 'tool_use',
            id: 'academic-content-call',
            name: 'get_arxiv_paper',
            input: { arxivId: 'secret-arxiv-id' }
          }] as never,
          tool_calls: [{
            id: 'academic-call',
            name: 'search_arxiv',
            args: { query: 'secret frontier query' }
          }]
        }),
        new ToolMessage({
          content: '{"papers":[{"title":"secret result"}]}',
          name: 'search_arxiv',
          tool_call_id: 'academic-call'
        })
      ]
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain('secret frontier query')
    expect(serialized).not.toContain('secret result')
    expect(serialized).not.toContain('secret-arxiv-id')
    expect(serialized).toContain(ACADEMIC_CHECKPOINT_REDACTION)
    expect(serialized).toContain('"omitted":true')
  })

  it('stores recoverable academic messages as file references', async () => {
    const artifactRoot = join(directory, 'artifacts')
    const firstDelegate = new MemorySaver().serde
    const firstSerializer = createRecoverableAcademicCheckpointSerializer(
      firstDelegate,
      createAcademicCheckpointArtifactStore(artifactRoot)
    )
    const value = {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'academic-call',
            name: 'search_arxiv',
            args: { query: 'recoverable secret query' }
          }]
        }),
        new ToolMessage({
          content: '{"papers":[{"title":"recoverable secret result"}]}',
          name: 'search_arxiv',
          tool_call_id: 'academic-call'
        })
      ]
    }

    const [type, data] = await firstSerializer.dumpsTyped(value)
    const persisted = Buffer.from(data).toString('utf8')
    expect(persisted).not.toContain('recoverable secret query')
    expect(persisted).not.toContain('recoverable secret result')
    expect(persisted).toContain('refora-academic-artifact:v1:')

    const reopenedSerializer = createRecoverableAcademicCheckpointSerializer(
      new MemorySaver().serde,
      createAcademicCheckpointArtifactStore(artifactRoot)
    )
    const restored = await reopenedSerializer.loadsTyped(type, data)
    const restoredText = JSON.stringify(restored)
    expect(restoredText).toContain('recoverable secret query')
    expect(restoredText).toContain('recoverable secret result')

    rmSync(artifactRoot, { recursive: true, force: true })
    const fallback = JSON.stringify(await reopenedSerializer.loadsTyped(type, data))
    expect(fallback).toContain(ACADEMIC_CHECKPOINT_REDACTION)
    expect(fallback).not.toContain('recoverable secret result')
  })

  it('removes only unshared academic artifacts when deleting checkpoint threads', async () => {
    const dbPath = join(directory, 'refora.sqlite')
    const service = createAgentCheckpointService(dbPath)
    const checkpointValue = {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [{
            id: 'shared-academic-call',
            name: 'search_arxiv',
            args: { query: 'shared checkpoint query' }
          }]
        })
      ]
    }
    const putThread = async (threadId: string) => {
      await service.checkpointer.put(
        { configurable: { thread_id: threadId, checkpoint_ns: '' } },
        {
          v: 4,
          id: randomUUID(),
          ts: new Date().toISOString(),
          channel_values: checkpointValue,
          channel_versions: { messages: 1 },
          versions_seen: {}
        },
        { source: 'input', step: -1, parents: {} }
      )
    }
    const artifactRoot = join(directory, '.refora-agent', 'shared', 'academic-artifacts')
    const artifactFiles = () => existsSync(artifactRoot)
      ? readdirSync(artifactRoot, { recursive: true })
          .filter((path) => path.endsWith('.json'))
      : []

    try {
      await putThread('thread-1')
      await putThread('thread-2')
      expect(artifactFiles()).toHaveLength(1)

      await service.deleteThread('thread-1')
      expect(artifactFiles()).toHaveLength(1)

      const rows = Reflect.get(
        service.checkpointer,
        'rows'
      ) as Map<string, string[]>
      expect(rows.get('thread-2')?.[0])
        .toContain('refora-academic-artifact:v1:')
      await service.deleteThread('thread-2')
      expect(rows.size).toBe(0)
      expect(artifactFiles()).toHaveLength(0)
    } finally {
      service.close()
    }
  })

  it('prunes temporary academic artifacts left by interrupted writes', async () => {
    const artifactRoot = join(directory, 'artifacts')
    const id = 'a'.repeat(64)
    const parent = join(artifactRoot, id.slice(0, 2))
    const temporary = join(parent, `${id}.json.${randomUUID()}.tmp`)
    mkdirSync(parent, { recursive: true })
    writeFileSync(temporary, 'partial artifact')

    const result = await createAcademicCheckpointArtifactStore(artifactRoot)
      .prune(new Set())

    expect(existsSync(temporary)).toBe(false)
    expect(result.deletedFiles).toBe(1)
    expect(result.remainingBytes).toBe(0)
  })

})
