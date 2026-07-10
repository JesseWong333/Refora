export function deriveThreadTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return 'New chat'
  const chars = Array.from(oneLine)
  if (chars.length <= 50) return oneLine

  const first50 = chars.slice(0, 50).join('')
  const sentenceMatch = first50.match(/[.!?。！？]/)
  if (sentenceMatch && sentenceMatch.index !== undefined && sentenceMatch.index > 10) {
    return chars.slice(0, sentenceMatch.index + 1).join('').trim()
  }

  const lastSpace = first50.lastIndexOf(' ')
  if (lastSpace > 10) return chars.slice(0, lastSpace).join('').trim() + '…'

  return first50 + '…'
}
