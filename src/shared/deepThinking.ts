export type DeepThinkingMode = 'native' | 'prompt' | 'none'

const NATIVE_MODEL_RE =
  /deepseek-r1|deepseek-reasoner|reasoner|qwq|o1|o3|o4|gpt-5|claude.*thinking|claude.*extended-thinking|glm.*thinking|r1|thinking/i

export function resolveDeepThinkingMode(modelId: string, baseUrl: string): DeepThinkingMode {
  const m = (modelId || '').trim().toLowerCase()
  const b = (baseUrl || '').trim().toLowerCase()
  if (!m) return 'prompt'
  if (NATIVE_MODEL_RE.test(m)) return 'native'
  if (b.length === 0) return 'prompt'
  return 'prompt'
}
