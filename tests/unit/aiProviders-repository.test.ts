import { beforeEach, describe, expect, it } from 'vitest'
import { createRepositories } from '../../src/main/db/repositories'
import {
  createMainTestDb,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

describe('aiProviders repository model selection', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
  })

  it('persists an explicit model list and can reset it to all models', () => {
    const provider = repos.aiProviders.create({
      presetId: 'ollama-local',
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiProtocol: 'openai-compatible',
      reasoningControl: 'thinking',
      reasoningEffort: 'medium',
      model: 'kimi-k2.6',
      models: ['kimi-k2.6', 'qwen3.7'],
      baseModel: 'kimi-k2.6',
      variant: '',
      variantFormat: 'none',
      apiKeyEnc: null,
      temperature: null,
      maxTokens: null
    })

    expect(provider.models).toEqual(['kimi-k2.6', 'qwen3.7'])
    expect(repos.aiProviders.getRaw(provider.id)?.models).toEqual([
      'kimi-k2.6',
      'qwen3.7'
    ])

    expect(repos.aiProviders.update(provider.id, { models: null }).models).toBeNull()
    expect(repos.aiProviders.list()[0].models).toBeNull()
  })
})
