import { REASONING_MODEL_TOKENS } from './modelVariant'

export type DeepThinkingMode = 'native' | 'prompt' | 'none'

const NATIVE_MODEL_RE = new RegExp(
  [
    ...REASONING_MODEL_TOKENS.map((t) => (/^o[134]$/.test(t) ? `\\b${t}\\b` : t)),
    'deepseek-reasoner',
    'claude.*thinking',
    'claude.*extended-thinking',
    'glm.*thinking',
    '\\br1\\b'
  ].join('|'),
  'i'
)

export function resolveDeepThinkingMode(modelId: string): DeepThinkingMode {
  const m = (modelId || '').trim().toLowerCase()
  if (!m) return 'prompt'
  if (NATIVE_MODEL_RE.test(m)) return 'native'
  return 'prompt'
}
