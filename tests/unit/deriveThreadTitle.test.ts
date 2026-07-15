import { describe, it, expect } from 'vitest'
import { deriveThreadTitle } from '../../src/main/services/deriveThreadTitle'

describe('deriveThreadTitle', () => {
  it('returns "New chat" for empty string', () => {
    expect(deriveThreadTitle('')).toBe('New chat')
  })

  it('returns "New chat" for whitespace-only string', () => {
    expect(deriveThreadTitle('   \n\t  ')).toBe('New chat')
  })

  it('returns short text as-is (single line)', () => {
    expect(deriveThreadTitle('Hello world')).toBe('Hello world')
  })

  it('returns exactly 50 chars as-is', () => {
    const text = 'a'.repeat(50)
    expect(deriveThreadTitle(text)).toBe(text)
  })

  it('truncates 51 chars to 50 + ellipsis (no word boundary)', () => {
    const text = 'a'.repeat(51)
    const result = deriveThreadTitle(text)
    expect(result).toBe('a'.repeat(50) + '…')
    expect(result.length).toBe(51)
  })

  it('collapses multi-line text to single line', () => {
    expect(deriveThreadTitle('line one\nline two\nline three')).toBe('line one line two line three')
  })

  it('collapses tabs and multiple spaces', () => {
    expect(deriveThreadTitle('hello    world\t\ttab')).toBe('hello world tab')
  })

  it('trims leading and trailing whitespace', () => {
    expect(deriveThreadTitle('  hello  ')).toBe('hello')
  })

  it('handles 50 Chinese characters without truncation', () => {
    const text = '机'.repeat(50)
    expect(deriveThreadTitle(text)).toBe(text)
  })

  it('truncates 51 Chinese characters to 50 + ellipsis', () => {
    const text = '机'.repeat(51)
    const result = deriveThreadTitle(text)
    expect(Array.from(result)).toHaveLength(51)
    expect(result.endsWith('…')).toBe(true)
  })

  it('handles emoji without splitting surrogate pairs', () => {
    const text = '😀'.repeat(50)
    expect(deriveThreadTitle(text)).toBe(text)
  })

  it('truncates text with mixed emoji and text correctly', () => {
    const text = '😀'.repeat(30) + 'a'.repeat(30)
    const result = deriveThreadTitle(text)
    const chars = Array.from(result)
    expect(chars.length).toBe(51)
    expect(chars[50]).toBe('…')
  })

  it('truncates at sentence boundary when within first 50 chars', () => {
    const text = 'This is a test. More text that goes on and on and on and on.'
    const result = deriveThreadTitle(text)
    expect(result).toBe('This is a test.')
  })

  it('truncates at word boundary when no sentence boundary found', () => {
    const text = 'abcdefghijklmnopqrstuvwxy zabcdefghijklmnopqrstuvwxy zabcdefgh'
    const result = deriveThreadTitle(text)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(51)
  })
})
