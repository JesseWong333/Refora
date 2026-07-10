import { HumanMessage, AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatMessage } from '../../shared/ipc-types'

export const TOOL_HISTORY_OUTPUT_MAX = 3000

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
  return `${output.slice(0, max)}\n…[truncated]`
}

export function lastIsAiWithToolCall(
  msgs: BaseMessage[],
  toolCallId: string,
  name: string
): boolean {
  if (msgs.length === 0) return false
  const last = msgs[msgs.length - 1]
  if (!(last instanceof AIMessage)) return false
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

export function historyToMessages(rows: ChatMessage[]): BaseMessage[] {
  const out: BaseMessage[] = []
  for (const row of rows) {
    if (row.role === 'user') {
      out.push(new HumanMessage(row.content))
      continue
    }
    if (row.role === 'assistant') {
      out.push(new AIMessage(row.content))
      continue
    }
    if (row.role === 'tool') {
      const parsed = parseToolPayload(row.content)
      const toolCallId = parsed.toolCallId ?? `legacy_${row.id}`
      const name = parsed.name ?? 'unknown'
      if (!lastIsAiWithToolCall(out, toolCallId, name)) {
        out.push(
          new AIMessage({
            content: '',
            tool_calls: [{ id: toolCallId, name, args: safeParseArgs(parsed.input) }]
          })
        )
      }
      out.push(
        new ToolMessage({
          content: truncateOutput(parsed.output ?? '', TOOL_HISTORY_OUTPUT_MAX),
          tool_call_id: toolCallId,
          name
        })
      )
    }
  }
  return out
}
