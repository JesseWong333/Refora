import { describe, expect, it, vi } from 'vitest'
import type { Repositories } from '../../src/main/db/repositories'
import type { AgentTraceStep } from '../../src/shared/ipc-types'
import {
  createAgentTraceRecorder,
  extractTokenUsage,
  extractToolCallId,
  truncateTraceText
} from '../../src/main/services/agentTraceRecorder'

function createRecorder() {
  let stepCounter = 0
  const steps = new Map<string, AgentTraceStep>()
  const addStep = vi.fn(
    (input: Parameters<Repositories['agentTraces']['addStep']>[0]): AgentTraceStep => {
      const step: AgentTraceStep = {
        id: `step-${++stepCounter}`,
        threadId: input.threadId,
        runId: input.runId,
        kind: input.kind,
        name: input.name ?? null,
        input: input.input ?? null,
        output: input.output ?? null,
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt ?? null,
        seq: input.seq,
        inputTokens: input.inputTokens ?? null,
        outputTokens: input.outputTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        parentStepId: input.parentStepId ?? null,
        agentName: input.agentName ?? null,
        namespace: input.namespace ?? null,
        depth: input.depth ?? 0,
        checkpointId: input.checkpointId ?? null
      }
      steps.set(step.id, step)
      return step
    }
  )
  const updateStep = vi.fn(
    (
      id: string,
      patch: Parameters<Repositories['agentTraces']['updateStep']>[1]
    ): AgentTraceStep | null => {
      const existing = steps.get(id)
      if (!existing) return null
      const step = { ...existing, ...patch }
      steps.set(id, step)
      return step
    }
  )
  const emitStep = vi.fn()
  const repos = { agentTraces: { addStep, updateStep } } as unknown as Pick<
    Repositories,
    'agentTraces'
  >
  const recorder = createAgentTraceRecorder({
    repos,
    threadId: 'thread-1',
    runId: 'run-1',
    emitStep
  })
  return { recorder, addStep, updateStep, emitStep }
}

describe('agentTraceRecorder', () => {
  it('closes every overlapping step that shares a fallback key', () => {
    const { recorder, updateStep } = createRecorder()
    const first = recorder.start('tool', 'search_library', null, ['tool-name:search_library'])
    const second = recorder.start('tool', 'search_library', null, ['tool-name:search_library'])

    recorder.finishOpen('cancelled', 'Cancelled')

    expect(updateStep.mock.calls.map(([id]) => id)).toEqual([first.id, second.id])
    expect(updateStep).toHaveBeenCalledWith(
      first.id,
      expect.objectContaining({ status: 'cancelled', output: 'Cancelled' })
    )
    expect(updateStep).toHaveBeenCalledWith(
      second.id,
      expect.objectContaining({ status: 'cancelled', output: 'Cancelled' })
    )
  })

  it('unwinds the newest matching fallback step first', () => {
    const { recorder } = createRecorder()
    const first = recorder.start('tool', 'search_library', null, ['tool-name:search_library'])
    const second = recorder.start('tool', 'search_library', null, ['tool-name:search_library'])

    expect(recorder.finishByKeys(['tool-name:search_library'], 'done', 'second')?.id).toBe(second.id)
    expect(recorder.finishByKeys(['tool-name:search_library'], 'done', 'first')?.id).toBe(first.id)
  })

  it('resolves event context to the newest open parent', () => {
    const { recorder } = createRecorder()
    const first = recorder.start('subagent', 'researcher', null, ['parent-run'])
    const second = recorder.start('subagent', 'analyst', null, ['parent-run'])

    expect(recorder.contextForEvent({
      parent_ids: ['root', 'parent-run'],
      metadata: {
        lc_agent_name: 'analyst',
        langgraph_checkpoint_ns: 'task:analyst'
      }
    })).toEqual({
      parentStepId: second.id,
      agentName: 'analyst',
      namespace: 'task:analyst',
      depth: 2
    })

    recorder.finish(second.id, 'done', null)
    expect(recorder.contextForEvent({ parent_ids: ['parent-run'] }).parentStepId).toBe(first.id)
  })

  it('keeps trace parsing and truncation behavior isolated from the agent service', () => {
    expect(extractToolCallId({}, { input: { tool_call_id: 'call-1' } })).toBe('call-1')
    expect(extractTokenUsage({
      output: { usage_metadata: { input_tokens: 3, output_tokens: 5 } }
    })).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 8 })
    expect(truncateTraceText('x'.repeat(4001))).toBe(`${'x'.repeat(4000)}\n...[truncated]`)
  })
})
