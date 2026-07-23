import { randomUUID } from 'node:crypto'
import type {
  AgentTraceStep,
  AgentTraceStepKind,
  AgentTraceStepStatus
} from '../../shared/ipc-types'
import type { Repositories } from '../db/repositories'
import { truncateOutput } from './chatHistoryMessages'

const TRACE_TEXT_LIMIT = 4000

interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface AgentTraceContext {
  parentStepId?: string | null
  agentName?: string | null
  namespace?: string | null
  depth?: number
  checkpointId?: string | null
}

interface AgentTraceRecorderInput {
  repos: Pick<Repositories, 'agentTraces'>
  threadId: string
  runId: string
  emitStep: (step: AgentTraceStep) => void
}

export function truncateTraceText(value: string | null | undefined): string | null {
  if (value == null) return null
  return truncateOutput(value, TRACE_TEXT_LIMIT)
}

export function stringifyTraceValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return truncateTraceText(value)
  try {
    return truncateTraceText(JSON.stringify(value))
  } catch {
    return truncateTraceText(String(value))
  }
}

export function extractToolName(event: {
  name?: string
  data?: Record<string, unknown>
}): string | null {
  if (typeof event.name === 'string' && event.name.length > 0) return event.name
  const data = event.data
  if (!data) return null
  if (typeof data.name === 'string' && data.name.length > 0) return data.name
  return null
}

export function extractToolInput(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if ('input' in data) return stringifyTraceValue(data.input)
  if ('inputs' in data) return stringifyTraceValue(data.inputs)
  return null
}

export function extractToolOutput(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if ('output' in data) return stringifyTraceValue(data.output)
  if ('outputs' in data) return stringifyTraceValue(data.outputs)
  return null
}

export function extractToolCallId(
  event: { run_id?: string },
  data: Record<string, unknown> | undefined
): string {
  if (data) {
    if (typeof data.tool_call_id === 'string' && data.tool_call_id) return data.tool_call_id
    const input = data.input
    if (input && typeof input === 'object' && 'tool_call_id' in input) {
      const value = (input as Record<string, unknown>).tool_call_id
      if (typeof value === 'string' && value) return value
    }
    if (typeof data.id === 'string' && data.id) return data.id
  }
  if (typeof event.run_id === 'string' && event.run_id) return event.run_id
  return randomUUID()
}

export function extractTokenUsage(data: Record<string, unknown> | undefined): TokenUsage | null {
  if (!data) return null
  const output = data.output as Record<string, unknown> | undefined
  if (!output || typeof output !== 'object') return null

  const usageMetadata = output.usage_metadata as Record<string, unknown> | undefined
  if (usageMetadata && typeof usageMetadata === 'object') {
    const inputTokens = usageMetadata.input_tokens
    const outputTokens = usageMetadata.output_tokens
    const totalTokens = usageMetadata.total_tokens
    if (typeof inputTokens === 'number' && typeof outputTokens === 'number') {
      return {
        inputTokens,
        outputTokens,
        totalTokens:
          typeof totalTokens === 'number' ? totalTokens : inputTokens + outputTokens
      }
    }
  }

  const responseMetadata = output.response_metadata as Record<string, unknown> | undefined
  const tokenUsage = (responseMetadata?.token_usage ??
    (output.additional_kwargs as Record<string, unknown> | undefined)?.token_usage) as
    | Record<string, unknown>
    | undefined
  if (tokenUsage && typeof tokenUsage === 'object') {
    const promptTokens = tokenUsage.prompt_tokens
    const completionTokens = tokenUsage.completion_tokens
    const totalTokens = tokenUsage.total_tokens
    if (typeof promptTokens === 'number' && typeof completionTokens === 'number') {
      return {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        totalTokens:
          typeof totalTokens === 'number' ? totalTokens : promptTokens + completionTokens
      }
    }
  }

  return null
}

export function createAgentTraceRecorder(input: AgentTraceRecorderInput) {
  let seq = 0
  const openByKey = new Map<string, string[]>()

  function addOpenKey(key: string, stepId: string): void {
    const stepIds = openByKey.get(key) ?? []
    stepIds.push(stepId)
    openByKey.set(key, stepIds)
  }

  function removeOpenStep(stepId: string): void {
    for (const [key, stepIds] of openByKey) {
      const remaining = stepIds.filter((id) => id !== stepId)
      if (remaining.length > 0) openByKey.set(key, remaining)
      else openByKey.delete(key)
    }
  }

  function start(
    kind: AgentTraceStepKind,
    name: string | null,
    traceInput: string | null,
    keys: string[] = [],
    context: AgentTraceContext = {}
  ): AgentTraceStep {
    const step = input.repos.agentTraces.addStep({
      threadId: input.threadId,
      runId: input.runId,
      kind,
      name,
      input: traceInput,
      output: null,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      seq: seq++,
      parentStepId: context.parentStepId ?? null,
      agentName: context.agentName ?? null,
      namespace: context.namespace ?? null,
      depth: context.depth ?? 0,
      checkpointId: context.checkpointId ?? null
    })
    for (const key of keys) addOpenKey(key, step.id)
    input.emitStep(step)
    return step
  }

  function finish(
    id: string,
    status: AgentTraceStepStatus,
    output: string | null,
    usage?: TokenUsage | null
  ): AgentTraceStep | null {
    removeOpenStep(id)
    const step = input.repos.agentTraces.updateStep(id, {
      status,
      output,
      endedAt: Date.now(),
      ...(usage
        ? {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens
          }
        : {})
    })
    if (step) input.emitStep(step)
    return step
  }

  function finishByKeys(
    keys: string[],
    status: AgentTraceStepStatus,
    output: string | null,
    usage?: TokenUsage | null
  ): AgentTraceStep | null {
    for (const key of keys) {
      const stepIds = openByKey.get(key)
      const id = stepIds?.[stepIds.length - 1]
      if (id) return finish(id, status, output, usage)
    }
    return null
  }

  function recordSnapshot(
    kind: AgentTraceStepKind,
    name: string | null,
    status: AgentTraceStepStatus,
    output: string | null,
    context: AgentTraceContext = {}
  ): AgentTraceStep {
    const now = Date.now()
    const step = input.repos.agentTraces.addStep({
      threadId: input.threadId,
      runId: input.runId,
      kind,
      name,
      input: null,
      output,
      status,
      startedAt: now,
      endedAt: now,
      seq: seq++,
      parentStepId: context.parentStepId ?? null,
      agentName: context.agentName ?? null,
      namespace: context.namespace ?? null,
      depth: context.depth ?? 0,
      checkpointId: context.checkpointId ?? null
    })
    input.emitStep(step)
    return step
  }

  function finishOpen(status: AgentTraceStepStatus, message: string): void {
    const ids = [...new Set([...openByKey.values()].flat())]
    for (const id of ids) finish(id, status, message)
  }

  function failOpen(message: string): void {
    finishOpen('error', message)
  }

  function contextForEvent(event: Record<string, unknown>): {
    parentStepId: string | null
    agentName: string | null
    namespace: string | null
    depth: number
  } {
    const parentIds = Array.isArray(event.parent_ids)
      ? event.parent_ids.filter((value): value is string => typeof value === 'string')
      : []
    let parentStepId: string | null = null
    for (let index = parentIds.length - 1; index >= 0; index -= 1) {
      const stepIds = openByKey.get(parentIds[index])
      const stepId = stepIds?.[stepIds.length - 1]
      if (stepId) {
        parentStepId = stepId
        break
      }
    }
    const metadata = event.metadata && typeof event.metadata === 'object'
      ? event.metadata as Record<string, unknown>
      : {}
    const agentName = typeof metadata.lc_agent_name === 'string'
      ? metadata.lc_agent_name
      : null
    const namespace = typeof metadata.langgraph_checkpoint_ns === 'string'
      ? metadata.langgraph_checkpoint_ns
      : null
    return { parentStepId, agentName, namespace, depth: parentIds.length }
  }

  return { start, finish, finishByKeys, recordSnapshot, finishOpen, failOpen, contextForEvent }
}

export type AgentTraceRecorder = ReturnType<typeof createAgentTraceRecorder>
