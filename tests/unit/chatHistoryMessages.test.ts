import { describe, it, expect } from 'vitest'
import { HumanMessage, AIMessage, ToolMessage } from '@langchain/core/messages'
import type { ChatMessage } from '../../src/shared/ipc-types'
import {
  parseToolPayload,
  truncateOutput,
  safeParseArgs,
  historyToMessages,
  sanitizeToolCallPairs
} from '../../src/main/services/chatHistoryMessages'

function makeMessage(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, threadId: 't1', role, content, createdAt: 0 }
}

describe('parseToolPayload', () => {
  it('parses v2 format', () => {
    const content = JSON.stringify({ v: 2, name: 'tool1', toolCallId: 'call_123', input: 'arg', output: 'result' })
    const parsed = parseToolPayload(content)
    expect(parsed.name).toBe('tool1')
    expect(parsed.toolCallId).toBe('call_123')
    expect(parsed.input).toBe('arg')
    expect(parsed.output).toBe('result')
  })

  it('parses v1 format', () => {
    const content = JSON.stringify({ name: 'tool1', input: 'arg', output: 'result' })
    const parsed = parseToolPayload(content)
    expect(parsed.name).toBe('tool1')
    expect(parsed.toolCallId).toBeNull()
    expect(parsed.input).toBe('arg')
    expect(parsed.output).toBe('result')
  })

  it('handles malformed JSON', () => {
    const parsed = parseToolPayload('not json')
    expect(parsed.name).toBe('unknown')
    expect(parsed.toolCallId).toBeNull()
    expect(parsed.input).toBe('not json')
    expect(parsed.output).toBe('not json')
  })
})

describe('truncateOutput', () => {
  it('returns short string unchanged', () => {
    expect(truncateOutput('short', 3000)).toBe('short')
  })

  it('truncates long string to max plus marker', () => {
    const long = 'x'.repeat(4000)
    const result = truncateOutput(long, 3000)
    expect(result).toBe('x'.repeat(3000) + '\n...[truncated]')
  })
})

describe('safeParseArgs', () => {
  it('returns empty object for null', () => {
    expect(safeParseArgs(null)).toEqual({})
  })

  it('parses valid JSON object', () => {
    expect(safeParseArgs('{"key":"val"}')).toEqual({ key: 'val' })
  })

  it('wraps invalid JSON in raw', () => {
    expect(safeParseArgs('hello')).toEqual({ raw: 'hello' })
  })

  it('wraps JSON array in raw', () => {
    expect(safeParseArgs('[1,2]')).toEqual({ raw: '[1,2]' })
  })
})

describe('historyToMessages', () => {
  it('v2 tool payload produces ToolMessage with preceding synthetic AIMessage', () => {
    const content = JSON.stringify({ v: 2, name: 'tool1', toolCallId: 'call_123', input: 'arg', output: 'result' })
    const msgs = historyToMessages([makeMessage('m1', 'tool', content)])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toBeInstanceOf(AIMessage)
    expect(msgs[1]).toBeInstanceOf(ToolMessage)
    const ai = msgs[0] as AIMessage
    expect(ai.tool_calls).toHaveLength(1)
    expect(ai.tool_calls![0].id).toBe('call_123')
    expect(ai.tool_calls![0].name).toBe('tool1')
    const tool = msgs[1] as ToolMessage
    expect(tool.tool_call_id).toBe('call_123')
    expect(tool.name).toBe('tool1')
    expect(tool.content).toBe('result')
  })

  it('v1 tool payload uses legacy tool_call_id', () => {
    const content = JSON.stringify({ name: 'tool1', input: 'arg', output: 'result' })
    const msgs = historyToMessages([makeMessage('m1', 'tool', content)])
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toBeInstanceOf(ToolMessage)
    const tool = msgs[1] as ToolMessage
    expect(tool.tool_call_id.startsWith('legacy_')).toBe(true)
    expect(tool.name).toBe('tool1')
  })

  it('truncates tool output over max', () => {
    const longOutput = 'x'.repeat(10000)
    const content = JSON.stringify({ v: 2, name: 'tool1', toolCallId: 'call_1', input: 'a', output: longOutput })
    const msgs = historyToMessages([makeMessage('m1', 'tool', content)])
    const tool = msgs.find((m) => m instanceof ToolMessage) as ToolMessage
    expect(tool.content).toBe('x'.repeat(3000) + '\n...[truncated]')
  })

  it('preserves ordering: user -> tool -> assistant', () => {
    const toolContent = JSON.stringify({ v: 2, name: 'tool1', toolCallId: 'call_1', input: 'a', output: 'r' })
    const msgs = historyToMessages([
      makeMessage('m1', 'user', 'hello'),
      makeMessage('m2', 'tool', toolContent),
      makeMessage('m3', 'assistant', 'world')
    ])
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toBeInstanceOf(HumanMessage)
    expect(msgs[1]).toBeInstanceOf(AIMessage)
    expect(msgs[2]).toBeInstanceOf(ToolMessage)
    expect(msgs[3]).toBeInstanceOf(AIMessage)
    expect((msgs[3] as AIMessage).content).toBe('world')
  })

  it('passes through user and assistant messages', () => {
    const msgs = historyToMessages([
      makeMessage('m1', 'user', 'hi'),
      makeMessage('m2', 'assistant', 'hello there')
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toBeInstanceOf(HumanMessage)
    expect((msgs[0] as HumanMessage).content).toBe('hi')
    expect(msgs[1]).toBeInstanceOf(AIMessage)
    expect((msgs[1] as AIMessage).content).toBe('hello there')
  })

  it('produces separate synthetic AIMessages for consecutive tool messages', () => {
    const tool1 = JSON.stringify({ v: 2, name: 'tool1', toolCallId: 'call_1', input: 'a', output: 'r1' })
    const tool2 = JSON.stringify({ v: 2, name: 'tool2', toolCallId: 'call_2', input: 'b', output: 'r2' })
    const msgs = historyToMessages([
      makeMessage('m1', 'tool', tool1),
      makeMessage('m2', 'tool', tool2)
    ])
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toBeInstanceOf(AIMessage)
    expect(msgs[1]).toBeInstanceOf(ToolMessage)
    expect(msgs[2]).toBeInstanceOf(AIMessage)
    expect(msgs[3]).toBeInstanceOf(ToolMessage)
    expect((msgs[1] as ToolMessage).tool_call_id).toBe('call_1')
    expect((msgs[3] as ToolMessage).tool_call_id).toBe('call_2')
  })

  it('handles malformed JSON tool message without crashing', () => {
    const msgs = historyToMessages([makeMessage('m1', 'tool', 'not json')])
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toBeInstanceOf(ToolMessage)
    const tool = msgs[1] as ToolMessage
    expect(tool.name).toBe('unknown')
    expect(tool.content).toBe('not json')
  })
})

describe('sanitizeToolCallPairs', () => {
  it('removes AIMessage with unpaired tool calls when no ToolMessage satisfies them', () => {
    const msgs = [
      new HumanMessage('hi'),
      new AIMessage({ content: '', tool_calls: [{ id: 'call_1', name: 'tool1', args: {} }] }),
      new AIMessage('response')
    ]
    sanitizeToolCallPairs(msgs)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toBeInstanceOf(HumanMessage)
    expect(msgs[1]).toBeInstanceOf(AIMessage)
    expect((msgs[1] as AIMessage).content).toBe('response')
  })

  it('inserts placeholder ToolMessage for partially unpaired tool calls', () => {
    const msgs = [
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'tool1', args: {} },
          { id: 'call_2', name: 'tool2', args: {} }
        ]
      }),
      new ToolMessage({ content: 'result1', tool_call_id: 'call_1', name: 'tool1' })
    ]
    sanitizeToolCallPairs(msgs)
    expect(msgs).toHaveLength(3)
    expect(msgs[1]).toBeInstanceOf(ToolMessage)
    const placeholder = msgs[1] as ToolMessage
    expect(placeholder.tool_call_id).toBe('call_2')
    expect(placeholder.content).toBe('[Tool result unavailable]')
  })

  it('leaves satisfied tool call pairs untouched', () => {
    const msgs = [
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'tool1', args: {} }]
      }),
      new ToolMessage({ content: 'result', tool_call_id: 'call_1', name: 'tool1' })
    ]
    sanitizeToolCallPairs(msgs)
    expect(msgs).toHaveLength(2)
  })
})
