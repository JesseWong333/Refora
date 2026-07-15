import { describe, it, expect } from 'vitest'
import {
  estimateTokens,
  estimateMessageTokens,
  truncateHistoryByTokens
} from '../../src/main/services/tokenEstimate'

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns ceil(length/4) for short ASCII strings', () => {
    expect(estimateTokens('hello')).toBe(2)
  })

  it('returns 100 for a 400-char ASCII string', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('estimates CJK characters at ~1 token each', () => {
    expect(estimateTokens('你好世界')).toBe(4)
  })

  it('estimates mixed CJK and ASCII content', () => {
    expect(estimateTokens('hello你好')).toBe(4)
  })

  it('estimates Korean (Hangul) characters at ~1 token each', () => {
    expect(estimateTokens('안녕하세요')).toBe(5)
  })

  it('estimates Japanese (Hiragana/Katakana) characters at ~1 token each', () => {
    expect(estimateTokens('こんにちは')).toBe(5)
    expect(estimateTokens('コンニチハ')).toBe(5)
  })

  it('counts CJK more conservatively than chars/4 for the same length', () => {
    const cjkText = '你好世界测试字符' // 8 chars, all CJK
    const asciiText = 'a'.repeat(8) // 8 chars, all ASCII
    expect(estimateTokens(cjkText)).toBeGreaterThan(estimateTokens(asciiText))
  })
})

describe('estimateMessageTokens', () => {
  it('adds role overhead (4 tokens) to content tokens', () => {
    expect(estimateMessageTokens('hello')).toBe(6)
    expect(estimateMessageTokens('')).toBe(4)
    expect(estimateMessageTokens('a'.repeat(400))).toBe(104)
  })
})

describe('truncateHistoryByTokens', () => {
  it('returns empty array for empty input', () => {
    expect(truncateHistoryByTokens([], { maxTokens: 1000, minMessages: 2, maxMessages: 50 })).toEqual([])
  })

  it('returns all messages when under budget', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'bye' }
    ]
    const result = truncateHistoryByTokens(msgs, { maxTokens: 8000, minMessages: 2, maxMessages: 50 })
    expect(result).toHaveLength(3)
    expect(result).toEqual(msgs)
  })

  it('keeps most recent and drops oldest when over budget', () => {
    const msgs = Array.from({ length: 10 }, () => ({
      role: 'user',
      content: 'x'.repeat(500)
    }))
    const result = truncateHistoryByTokens(msgs, { maxTokens: 500, minMessages: 2, maxMessages: 50 })
    expect(result.length).toBeLessThan(10)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const lastContent = msgs[msgs.length - 1].content
    expect(result[result.length - 1].content).toBe(lastContent)
    const secondLastContent = msgs[msgs.length - 2].content
    expect(result[result.length - 2].content).toBe(secondLastContent)
  })

  it('always keeps at least minMessages even if over budget', () => {
    const msgs = Array.from({ length: 5 }, () => ({
      role: 'user',
      content: 'x'.repeat(10000)
    }))
    const result = truncateHistoryByTokens(msgs, { maxTokens: 100, minMessages: 2, maxMessages: 50 })
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(msgs[msgs.length - 2])
    expect(result[1]).toBe(msgs[msgs.length - 1])
  })

  it('caps at maxMessages', () => {
    const msgs = Array.from({ length: 100 }, (_, i) => ({
      role: 'user',
      content: `msg-${i}`
    }))
    const result = truncateHistoryByTokens(msgs, { maxTokens: 8000, minMessages: 2, maxMessages: 10 })
    expect(result).toHaveLength(10)
    expect(result[0]).toBe(msgs[90])
    expect(result[9]).toBe(msgs[99])
  })

  it('returns a single huge message when minMessages=1', () => {
    const msgs = [{ role: 'user', content: 'x'.repeat(100000) }]
    const result = truncateHistoryByTokens(msgs, { maxTokens: 100, minMessages: 1, maxMessages: 50 })
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(msgs[0])
  })

  it('preserves message order (oldest first in output)', () => {
    const msgs = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
      { role: 'assistant', content: 'fourth' },
      { role: 'user', content: 'fifth' }
    ]
    const result = truncateHistoryByTokens(msgs, { maxTokens: 8000, minMessages: 2, maxMessages: 50 })
    expect(result.map((m) => m.content)).toEqual([
      'first',
      'second',
      'third',
      'fourth',
      'fifth'
    ])
  })

  it('always includes the most recent message', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: 'user',
      content: `message-${i}`
    }))
    const result = truncateHistoryByTokens(msgs, { maxTokens: 50, minMessages: 2, maxMessages: 50 })
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result[result.length - 1].content).toBe('message-19')
  })

  it('truncates CJK content more aggressively than ASCII of the same length', () => {
    const cjkMsgs = Array.from({ length: 10 }, () => ({
      role: 'user',
      content: '你好世界'.repeat(50) // 200 chars, all CJK -> ~200 tokens each
    }))
    const asciiMsgs = Array.from({ length: 10 }, () => ({
      role: 'user',
      content: 'a'.repeat(200) // 200 chars, all ASCII -> ~50 tokens each
    }))
    const cjkResult = truncateHistoryByTokens(cjkMsgs, {
      maxTokens: 500,
      minMessages: 2,
      maxMessages: 50
    })
    const asciiResult = truncateHistoryByTokens(asciiMsgs, {
      maxTokens: 500,
      minMessages: 2,
      maxMessages: 50
    })
    expect(cjkResult.length).toBeLessThan(asciiResult.length)
  })
})
