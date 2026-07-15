import { describe, it, expect } from 'vitest'
import { resolveDeepThinkingMode } from '../../src/shared/deepThinking'

describe('resolveDeepThinkingMode', () => {
  it('detects native mode for deepseek-r1', () => {
    expect(resolveDeepThinkingMode('deepseek-r1')).toBe('native')
  })

  it('detects native mode for deepseek-reasoner', () => {
    expect(resolveDeepThinkingMode('deepseek-reasoner')).toBe('native')
  })

  it('detects native mode for o1, o3-mini, o4-mini', () => {
    expect(resolveDeepThinkingMode('o1')).toBe('native')
    expect(resolveDeepThinkingMode('o3-mini')).toBe('native')
    expect(resolveDeepThinkingMode('o4-mini')).toBe('native')
  })

  it('detects native mode for gpt-5', () => {
    expect(resolveDeepThinkingMode('gpt-5')).toBe('native')
  })

  it('detects native mode for qwq-32b', () => {
    expect(resolveDeepThinkingMode('qwq-32b')).toBe('native')
  })

  it('detects native mode for models with thinking in the name', () => {
    expect(resolveDeepThinkingMode('thinking')).toBe('native')
    expect(resolveDeepThinkingMode('my-thinking-model')).toBe('native')
    expect(resolveDeepThinkingMode('glm-4-thinking')).toBe('native')
  })

  it('detects native mode for claude-thinking variants', () => {
    expect(resolveDeepThinkingMode('claude-thinking')).toBe('native')
    expect(resolveDeepThinkingMode('claude-3-7-sonnet-thinking')).toBe('native')
    expect(resolveDeepThinkingMode('claude-extended-thinking')).toBe('native')
  })

  it('detects prompt mode for gpt-4o', () => {
    expect(resolveDeepThinkingMode('gpt-4o')).toBe('prompt')
  })

  it('detects prompt mode for deepseek-chat', () => {
    expect(resolveDeepThinkingMode('deepseek-chat')).toBe('prompt')
  })

  it('detects prompt mode for claude-3-5-sonnet', () => {
    expect(resolveDeepThinkingMode('claude-3-5-sonnet')).toBe('prompt')
  })

  it('returns prompt mode for empty model id', () => {
    expect(resolveDeepThinkingMode('')).toBe('prompt')
  })

  it('detects prompt mode for random models', () => {
    expect(resolveDeepThinkingMode('llama-3-70b')).toBe('prompt')
  })

  it('does not false-positive on models with r1 substring', () => {
    expect(resolveDeepThinkingMode('tier1')).toBe('prompt')
    expect(resolveDeepThinkingMode('carrier1')).toBe('prompt')
    expect(resolveDeepThinkingMode('user1')).toBe('prompt')
  })

  it('does not false-positive on models with o1/o3/o4 substring', () => {
    expect(resolveDeepThinkingMode('pro1')).toBe('prompt')
    expect(resolveDeepThinkingMode('pro3')).toBe('prompt')
    expect(resolveDeepThinkingMode('pro4')).toBe('prompt')
    expect(resolveDeepThinkingMode('video1')).toBe('prompt')
  })
})
