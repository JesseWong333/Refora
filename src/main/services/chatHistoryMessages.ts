import type { ChatMessage } from '../../shared/ipc-types'

export const TOOL_HISTORY_OUTPUT_MAX = 3000

export interface AgentWireMessage {
  [key: string]: unknown
  role: 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
}

interface ParsedToolPayload {
  name: string
  toolCallId: string | null
  input: string | null
  output: string | null
}

export function parseToolPayload(content: string): ParsedToolPayload {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const name = typeof parsed.name === 'string' ? parsed.name : 'unknown'
    const input =
      typeof parsed.input === 'string' ? parsed.input : parsed.input != null ? JSON.stringify(parsed.input) : null
    const output =
      typeof parsed.output === 'string'
        ? parsed.output
        : parsed.output != null
          ? JSON.stringify(parsed.output)
          : null
    const toolCallId =
      typeof parsed.toolCallId === 'string' ? parsed.toolCallId : null
    return { name, toolCallId, input, output }
  } catch {
    return { name: 'unknown', toolCallId: null, input: content, output: content }
  }
}

export function truncateOutput(output: string, max: number): string {
  if (output.length <= max) return output
  return `${output.slice(0, max)}\n...[truncated]`
}

export function lastIsAiWithToolCall(
  msgs: AgentWireMessage[],
  toolCallId: string,
  name: string
): boolean {
  if (msgs.length === 0) return false
  const last = msgs[msgs.length - 1]
  if (last.role !== 'assistant') return false
  const calls = last.tool_calls
  if (!Array.isArray(calls) || calls.length === 0) return false
  return calls.some(
    (c) =>
      c.id === toolCallId &&
      c.name === name
  )
}

export function safeParseArgs(input: string | null): Record<string, unknown> {
  if (input == null) return {}
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return { raw: input }
  } catch {
    return { raw: input }
  }
}

export function historyToMessages(rows: ChatMessage[]): AgentWireMessage[] {
  const out: AgentWireMessage[] = []
  for (const row of rows) {
    if (row.role === 'user') {
      out.push({ role: 'user', content: row.content })
      continue
    }
    if (row.role === 'assistant') {
      out.push({ role: 'assistant', content: row.content })
      continue
    }
    if (row.role === 'tool') {
      const parsed = parseToolPayload(row.content)
      const toolCallId = parsed.toolCallId ?? `legacy_${row.id}`
      const name = parsed.name ?? 'unknown'
      if (!lastIsAiWithToolCall(out, toolCallId, name)) {
        out.push({
          role: 'assistant',
          content: '',
          tool_calls: [{ id: toolCallId, name, args: safeParseArgs(parsed.input) }]
        })
      }
      out.push({
        role: 'tool',
        content: truncateOutput(parsed.output ?? '', TOOL_HISTORY_OUTPUT_MAX),
        tool_call_id: toolCallId,
        name
      })
    }
  }
  sanitizeToolCallPairs(out)
  return out
}

export function sanitizeToolCallPairs(messages: AgentWireMessage[]): void {
  const knownToolCallIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const calls = msg.tool_calls
      if (Array.isArray(calls)) {
        for (const c of calls) {
          if (c.id) knownToolCallIds.add(c.id)
        }
      }
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role === 'tool' && msg.tool_call_id && !knownToolCallIds.has(msg.tool_call_id)) {
      messages.splice(i, 1)
    }
  }

  const satisfiedIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      satisfiedIds.add(msg.tool_call_id)
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const calls = msg.tool_calls
    if (!Array.isArray(calls) || calls.length === 0) continue

    const unpaired = calls.filter((c) => c.id && !satisfiedIds.has(c.id))
    if (unpaired.length === 0) continue

    if (unpaired.length === calls.length) {
      messages.splice(i, 1)
    } else {
      const placeholders: AgentWireMessage[] = unpaired.map((call) => ({
        role: 'tool',
        content: '[Tool result unavailable]',
        tool_call_id: call.id,
        name: call.name ?? 'unknown'
      }))
      messages.splice(i + 1, 0, ...placeholders)
      for (const c of unpaired) satisfiedIds.add(c.id!)
    }
  }
}
