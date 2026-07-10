export function deriveThreadTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return 'New chat'
  const chars = Array.from(oneLine)
  return chars.length <= 40 ? oneLine : chars.slice(0, 40).join('') + '…'
}
