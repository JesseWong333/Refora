import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../src/shared/ipc-types'
import {
  historyToMessages,
  parseToolPayload,
  safeParseArgs,
  sanitizeToolCallPairs,
  truncateOutput,
  type AgentWireMessage
} from '../../src/main/services/chatHistoryMessages'

function makeMessage(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, threadId: 't1', role, content, createdAt: 0 }
}

describe('Agent Python history wire format', () => {
  it('parses current, legacy, and malformed persisted tool payloads', () => {
    expect(parseToolPayload(JSON.stringify({
      v: 2,
      name: 'tool1',
      toolCallId: 'call_123',
      input: 'arg',
      output: 'result'
    }))).toEqual({
      name: 'tool1',
      toolCallId: 'call_123',
      input: 'arg',
      output: 'result'
    })
    expect(parseToolPayload(JSON.stringify({
      name: 'tool1',
      input: 'arg',
      output: 'result'
    }))).toMatchObject({ name: 'tool1', toolCallId: null })
    expect(parseToolPayload('not json')).toEqual({
      name: 'unknown',
      toolCallId: null,
      input: 'not json',
      output: 'not json'
    })
  })

  it('preserves truncation and safe argument parsing', () => {
    expect(truncateOutput('short', 3000)).toBe('short')
    expect(truncateOutput('x'.repeat(4000), 3000))
      .toBe(`${'x'.repeat(3000)}\n...[truncated]`)
    expect(safeParseArgs(null)).toEqual({})
    expect(safeParseArgs('{"key":"val"}')).toEqual({ key: 'val' })
    expect(safeParseArgs('hello')).toEqual({ raw: 'hello' })
    expect(safeParseArgs('[1,2]')).toEqual({ raw: '[1,2]' })
  })

  it('converts persisted chat rows to Python-compatible message dictionaries', () => {
    const tool = JSON.stringify({
      v: 2,
      name: 'search_library',
      toolCallId: 'call_1',
      input: '{"query":"agents"}',
      output: 'x'.repeat(4000)
    })
    const messages = historyToMessages([
      makeMessage('m1', 'user', 'hello'),
      makeMessage('m2', 'tool', tool),
      makeMessage('m3', 'assistant', 'world')
    ])

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call_1',
          name: 'search_library',
          args: { query: 'agents' }
        }]
      },
      {
        role: 'tool',
        content: `${'x'.repeat(3000)}\n...[truncated]`,
        tool_call_id: 'call_1',
        name: 'search_library'
      },
      { role: 'assistant', content: 'world' }
    ])
  })

  it('uses stable legacy call IDs and keeps consecutive tool calls paired', () => {
    const first = JSON.stringify({ name: 'one', input: '{}', output: '1' })
    const second = JSON.stringify({
      v: 2,
      name: 'two',
      toolCallId: 'call_2',
      input: '{}',
      output: '2'
    })
    const messages = historyToMessages([
      makeMessage('legacy', 'tool', first),
      makeMessage('current', 'tool', second)
    ])

    expect(messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool'
    ])
    expect(messages[1].tool_call_id).toBe('legacy_legacy')
    expect(messages[3].tool_call_id).toBe('call_2')
  })

  it('removes wholly unpaired calls and fills partially missing results', () => {
    const unpaired: AgentWireMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', name: 'one', args: {} }]
      },
      { role: 'assistant', content: 'response' }
    ]
    sanitizeToolCallPairs(unpaired)
    expect(unpaired).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'response' }
    ])

    const partial: AgentWireMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'one', args: {} },
          { id: 'call_2', name: 'two', args: {} }
        ]
      },
      {
        role: 'tool',
        content: 'result',
        tool_call_id: 'call_1',
        name: 'one'
      }
    ]
    sanitizeToolCallPairs(partial)
    expect(partial[1]).toEqual({
      role: 'tool',
      content: '[Tool result unavailable]',
      tool_call_id: 'call_2',
      name: 'two'
    })
  })
})
