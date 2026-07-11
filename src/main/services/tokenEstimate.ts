const CHARS_PER_TOKEN = 4
const ROLE_OVERHEAD_TOKENS = 4
const CJK_CHARS_PER_TOKEN = 1

const CJK_PATTERN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(CJK_PATTERN) ?? []).length
  const nonCjk = text.length - cjk
  return Math.ceil(cjk * CJK_CHARS_PER_TOKEN + nonCjk / CHARS_PER_TOKEN)
}

export function estimateMessageTokens(content: string): number {
  return estimateTokens(content) + ROLE_OVERHEAD_TOKENS
}

export interface TokenBudgetOptions {
  maxTokens: number
  minMessages: number
  maxMessages: number
}

export interface MessageLike {
  role: string
  content: string
}

export function truncateHistoryByTokens(
  messages: MessageLike[],
  options: TokenBudgetOptions
): MessageLike[] {
  const { maxTokens, minMessages, maxMessages } = options
  if (messages.length === 0) return []

  const capped = messages.slice(-maxMessages)
  if (capped.length <= minMessages) return capped

  let budget = maxTokens
  const kept: MessageLike[] = []

  for (let i = capped.length - 1; i >= 0; i--) {
    const msg = capped[i]
    const cost = estimateMessageTokens(msg.content)
    if (kept.length >= minMessages) {
      if (budget < cost) break
    }
    budget -= cost
    kept.unshift(msg)
  }

  const result = kept.length > 0 ? kept : (minMessages > 0 ? capped.slice(-minMessages) : [])

  let startIdx = 0
  while (startIdx < result.length && result[startIdx].role === 'tool') {
    startIdx++
  }
  return result.slice(startIdx)
}
