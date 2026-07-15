import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')

function createTestDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF')
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    getUserVersion: () => {
      const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      return row.user_version
    },
    setUserVersion: (version: number) => {
      raw.exec(`PRAGMA user_version = ${version}`)
    }
  }
  runMigrations(db)
  seedDefaultSettings(db, 'en')
  return db
}

let db: ReturnType<typeof createTestDb>
let repos: ReturnType<typeof createRepositories>

beforeEach(() => {
  db = createTestDb()
  repos = createRepositories(db)
})

describe('AgentTracesRepository', () => {
  describe('addStep', () => {
    it('inserts and returns step with all fields', () => {
      const step = repos.agentTraces.addStep({
        threadId: 't1',
        runId: 'r1',
        kind: 'llm',
        name: 'model_call',
        input: 'what is x?',
        output: 'x is 42',
        status: 'done',
        startedAt: 1000,
        endedAt: 2000,
        seq: 0
      })
      expect(step.id).toBeTypeOf('string')
      expect(step.threadId).toBe('t1')
      expect(step.runId).toBe('r1')
      expect(step.kind).toBe('llm')
      expect(step.name).toBe('model_call')
      expect(step.input).toBe('what is x?')
      expect(step.output).toBe('x is 42')
      expect(step.status).toBe('done')
      expect(step.startedAt).toBe(1000)
      expect(step.endedAt).toBe(2000)
      expect(step.seq).toBe(0)
    })

    it('inserts step with optional fields (name, input, output, endedAt) null', () => {
      const step = repos.agentTraces.addStep({
        threadId: 't1',
        runId: 'r1',
        kind: 'tool',
        status: 'running',
        startedAt: 3000,
        seq: 1
      })
      expect(step.name).toBeNull()
      expect(step.input).toBeNull()
      expect(step.output).toBeNull()
      expect(step.endedAt).toBeNull()
      expect(step.status).toBe('running')
    })

    it('supports all step kinds', () => {
      const llm = repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 0, seq: 0 })
      const tool = repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'tool', status: 'done', startedAt: 0, seq: 1 })
      const run = repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'run', status: 'done', startedAt: 0, seq: 2 })
      expect(llm.kind).toBe('llm')
      expect(tool.kind).toBe('tool')
      expect(run.kind).toBe('run')
    })
  })

  describe('updateStep', () => {
    it('updates output, status, endedAt', () => {
      const step = repos.agentTraces.addStep({
        threadId: 't1',
        runId: 'r1',
        kind: 'llm',
        status: 'running',
        startedAt: 1000,
        seq: 0
      })
      const updated = repos.agentTraces.updateStep(step.id, {
        output: 'result text',
        status: 'done',
        endedAt: 2000
      })
      expect(updated).not.toBeNull()
      expect(updated!.output).toBe('result text')
      expect(updated!.status).toBe('done')
      expect(updated!.endedAt).toBe(2000)
    })

    it('preserves existing values when patch omits them', () => {
      const step = repos.agentTraces.addStep({
        threadId: 't1',
        runId: 'r1',
        kind: 'tool',
        name: 'search',
        input: 'query',
        output: 'old output',
        status: 'running',
        startedAt: 1000,
        seq: 0
      })
      const updated = repos.agentTraces.updateStep(step.id, { status: 'error' })
      expect(updated!.output).toBe('old output')
      expect(updated!.status).toBe('error')
    })

    it('returns null for non-existent id', () => {
      expect(repos.agentTraces.updateStep('nonexistent', { status: 'done' })).toBeNull()
    })

    it('can set output to null', () => {
      const step = repos.agentTraces.addStep({
        threadId: 't1',
        runId: 'r1',
        kind: 'llm',
        output: 'some output',
        status: 'running',
        startedAt: 1000,
        seq: 0
      })
      const updated = repos.agentTraces.updateStep(step.id, { output: null })
      expect(updated!.output).toBeNull()
    })
  })

  describe('listByThread', () => {
    it('returns steps filtered by threadId, ordered by startedAt ASC then seq ASC', () => {
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 3000, seq: 1 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'tool', status: 'done', startedAt: 1000, seq: 0 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'run', status: 'done', startedAt: 2000, seq: 0 })

      const steps = repos.agentTraces.listByThread('t1')
      expect(steps).toHaveLength(3)
      expect(steps[0].startedAt).toBe(1000)
      expect(steps[1].startedAt).toBe(2000)
      expect(steps[2].startedAt).toBe(3000)
    })

    it('orders by seq ASC when startedAt is the same', () => {
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 1000, seq: 2 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'tool', status: 'done', startedAt: 1000, seq: 0 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'run', status: 'done', startedAt: 1000, seq: 1 })

      const steps = repos.agentTraces.listByThread('t1')
      expect(steps[0].seq).toBe(0)
      expect(steps[1].seq).toBe(1)
      expect(steps[2].seq).toBe(2)
    })

    it('only returns steps for the specified thread', () => {
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 0, seq: 0 })
      repos.agentTraces.addStep({ threadId: 't2', runId: 'r1', kind: 'llm', status: 'done', startedAt: 0, seq: 0 })
      expect(repos.agentTraces.listByThread('t1')).toHaveLength(1)
      expect(repos.agentTraces.listByThread('t2')).toHaveLength(1)
      expect(repos.agentTraces.listByThread('t3')).toHaveLength(0)
    })
  })

  describe('listByRun', () => {
    it('returns steps filtered by runId, ordered by seq ASC', () => {
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 3000, seq: 2 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'tool', status: 'done', startedAt: 1000, seq: 0 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'run', status: 'done', startedAt: 2000, seq: 1 })

      const steps = repos.agentTraces.listByRun('r1')
      expect(steps).toHaveLength(3)
      expect(steps[0].seq).toBe(0)
      expect(steps[1].seq).toBe(1)
      expect(steps[2].seq).toBe(2)
    })

    it('only returns steps for the specified runId', () => {
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 0, seq: 0 })
      repos.agentTraces.addStep({ threadId: 't1', runId: 'r2', kind: 'llm', status: 'done', startedAt: 0, seq: 0 })
      expect(repos.agentTraces.listByRun('r1')).toHaveLength(1)
      expect(repos.agentTraces.listByRun('r2')).toHaveLength(1)
      expect(repos.agentTraces.listByRun('r3')).toHaveLength(0)
    })

    it('multiple steps with different seq values are returned in correct order', () => {
      for (let i = 0; i < 5; i++) {
        repos.agentTraces.addStep({ threadId: 't1', runId: 'r1', kind: 'llm', status: 'done', startedAt: 1000 - i, seq: 4 - i })
      }
      const steps = repos.agentTraces.listByRun('r1')
      expect(steps).toHaveLength(5)
      for (let i = 0; i < 5; i++) {
        expect(steps[i].seq).toBe(i)
      }
    })
  })
})
