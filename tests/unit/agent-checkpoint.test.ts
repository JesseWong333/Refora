import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACADEMIC_CHECKPOINT_REDACTION,
  AGENT_STATE_VERSION,
  createAgentCheckpointService,
  sanitizeAcademicCheckpointValue
} from '../../src/main/services/agentCheckpoint'

describe('Python Agent checkpoint service', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-agent-checkpoint-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('uses a new state version for Python checkpoint serialization', () => {
    expect(AGENT_STATE_VERSION).toBe(2)
  })

  it('redacts academic tool arguments and results from trace snapshots', () => {
    const sanitized = sanitizeAcademicCheckpointValue({
      messages: [
        {
          type: 'ai',
          tool_calls: [{
            id: 'academic-call',
            name: 'search_arxiv',
            args: { query: 'secret frontier query' }
          }]
        },
        {
          type: 'tool',
          content: '{"papers":[{"title":"secret result"}]}',
          name: 'search_arxiv',
          tool_call_id: 'academic-call'
        }
      ]
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain('secret frontier query')
    expect(serialized).not.toContain('secret result')
    expect(serialized).toContain(ACADEMIC_CHECKPOINT_REDACTION)
    expect(serialized).toContain('"omitted":true')
  })

  it('uses an isolated Python checkpoint database and tolerates a missing database', async () => {
    const dbPath = join(directory, 'refora.sqlite')
    const service = createAgentCheckpointService(dbPath)

    expect(service.checkpointPath).toBe(
      join(directory, '.refora-agent', 'shared', 'checkpoints-python.sqlite')
    )
    await expect(service.getHead('thread-1')).resolves.toBeNull()
    await expect(service.deleteThread('thread-1')).resolves.toBeUndefined()
  })
})
