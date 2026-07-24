import { describe, expect, it, vi } from 'vitest'
import type { AiProvider } from '../../src/shared/ipc-types'

vi.mock('../../src/main/services/logger', () => ({
  logger: { warn: vi.fn() }
}))

import { generateThreadTitle } from '../../src/main/services/generateThreadTitle'

const provider: AiProvider = {
  id: 'provider-1',
  presetId: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiProtocol: 'openai-chat',
  reasoningControl: 'none',
  reasoningEffort: 'none',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1
}

describe('generateThreadTitle Python backend', () => {
  it('delegates title generation with the same non-reasoning limits', async () => {
    const generateTitle = vi.fn(async () => 'Paper Comparison')

    await expect(generateThreadTitle(
      { generateTitle } as never,
      'gpt-4o',
      provider,
      'secret',
      'Compare these papers'
    )).resolves.toBe('Paper Comparison')

    expect(generateTitle).toHaveBeenCalledWith(
      {
        provider: {
          model: 'gpt-4o',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'secret',
          useResponsesApi: false,
          modelKwargs: {},
          temperature: 0.3,
          maxTokens: 30
        },
        userMessage: 'Compare these papers',
        reasoningModel: false
      },
      expect.any(AbortSignal)
    )
  })

  it('keeps the derived title when the Python model call fails', async () => {
    await expect(generateThreadTitle(
      {
        generateTitle: vi.fn(async () => {
          throw new Error('offline')
        })
      } as never,
      'gpt-4o',
      provider,
      'secret',
      'Question'
    )).resolves.toBeNull()
  })
})
