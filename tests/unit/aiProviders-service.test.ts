import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockSafeStorage, mockFetch } = vi.hoisted(() => ({
  mockSafeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => {
      const s = b.toString()
      return s.startsWith('enc:') ? s.slice(4) : s
    })
  },
  mockFetch: vi.fn()
}))

vi.mock('electron', () => ({
  safeStorage: mockSafeStorage,
  net: { fetch: mockFetch }
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import { createAiProvidersService } from '../../src/main/services/aiProviders'
import { RepoError } from '../../src/main/db/repositories/errors'
import type {
  AiProviderInput,
  AiProviderRawRow
} from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'

type AiProvidersRepo = Repositories['aiProviders']

function makeRawRow(overrides: Partial<AiProviderRawRow> = {}): AiProviderRawRow {
  return {
    id: 'p1',
    presetId: 'openai',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com/v1',
    apiProtocol: 'openai-compatible',
    reasoningControl: 'openai',
    reasoningEffort: 'medium',
    model: 'gpt-4o',
    baseModel: 'gpt-4o',
    variant: '',
    variantFormat: 'dash',
    apiKeyEnc: Buffer.from('enc:secret-key'),
    temperature: null,
    maxTokens: null,
    createdAt: 1700000000000,
    ...overrides
  }
}

function makeMockRepo(overrides: Partial<AiProvidersRepo> = {}): AiProvidersRepo {
  const rows = new Map<string, AiProviderRawRow>()
  const defaultRow = makeRawRow()
  rows.set('p1', defaultRow)

  return {
    list: vi.fn(() => Array.from(rows.values()).map((r) => ({
      id: r.id,
      name: r.name,
      baseUrl: r.baseUrl,
      model: r.model,
      baseModel: r.baseModel,
      variant: r.variant,
      variantFormat: r.variantFormat,
      hasKey: r.apiKeyEnc != null,
      temperature: r.temperature,
      maxTokens: r.maxTokens,
      createdAt: r.createdAt
    }))),
    getRaw: vi.fn((id: string) => rows.get(id) ?? null),
    create: vi.fn((input) => {
      const row: AiProviderRawRow = {
        id: 'new-id',
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        baseModel: input.baseModel,
        variant: input.variant,
        variantFormat: input.variantFormat,
        apiKeyEnc: input.apiKeyEnc,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        createdAt: Date.now()
      }
      rows.set(row.id, row)
      return {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        model: row.model,
        baseModel: row.baseModel,
        variant: row.variant,
        variantFormat: row.variantFormat,
        hasKey: row.apiKeyEnc != null,
        temperature: row.temperature,
        maxTokens: row.maxTokens,
        createdAt: row.createdAt
      }
    }),
    update: vi.fn((id: string, input) => {
      const existing = rows.get(id)
      if (!existing) throw new RepoError('not_found', `provider not found: ${id}`)
      const updated = { ...existing }
      if (input.name !== undefined) updated.name = input.name
      if (input.baseUrl !== undefined) updated.baseUrl = input.baseUrl
      if (input.model !== undefined) updated.model = input.model
      if (input.baseModel !== undefined) updated.baseModel = input.baseModel
      if (input.variant !== undefined) updated.variant = input.variant
      if (input.variantFormat !== undefined) updated.variantFormat = input.variantFormat
      if (input.apiKeyEnc !== undefined) updated.apiKeyEnc = input.apiKeyEnc
      if (input.temperature !== undefined) updated.temperature = input.temperature
      if (input.maxTokens !== undefined) updated.maxTokens = input.maxTokens
      rows.set(id, updated)
      return {
        id: updated.id,
        name: updated.name,
        baseUrl: updated.baseUrl,
        model: updated.model,
        baseModel: updated.baseModel,
        variant: updated.variant,
        variantFormat: updated.variantFormat,
        hasKey: updated.apiKeyEnc != null,
        temperature: updated.temperature,
        maxTokens: updated.maxTokens,
        createdAt: updated.createdAt
      }
    }),
    delete: vi.fn((id: string) => {
      if (!rows.has(id)) throw new RepoError('not_found', `provider not found: ${id}`)
      rows.delete(id)
    }),
    ...overrides
  }
}

function makeMockRepos(repoOverrides: Partial<AiProvidersRepo> = {}): Repositories {
  return { aiProviders: makeMockRepo(repoOverrides) } as unknown as Repositories
}

let repos: Repositories
let service: ReturnType<typeof createAiProvidersService>

beforeEach(() => {
  vi.clearAllMocks()
  mockSafeStorage.isEncryptionAvailable.mockReturnValue(true)
  mockSafeStorage.encryptString.mockImplementation((s: string) => Buffer.from(`enc:${s}`))
  mockSafeStorage.decryptString.mockImplementation((b: Buffer) => {
    const s = b.toString()
    return s.startsWith('enc:') ? s.slice(4) : s
  })
  mockFetch.mockReset()
  repos = makeMockRepos()
  service = createAiProvidersService(repos)
})

describe('AiProvidersService', () => {
  describe('list', () => {
    it('delegates to repos.aiProviders.list()', () => {
      const result = service.list()
      expect(repos.aiProviders.list).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p1')
    })
  })

  describe('create', () => {
    it('with full input: calls repos.aiProviders.create with resolved model fields', () => {
      const input: AiProviderInput = {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        models: [' gpt-4o ', 'gpt-4o', 'gpt-5'],
        baseModel: 'gpt-4o',
        variant: '',
        variantFormat: 'dash',
        apiKey: 'sk-test',
        temperature: 0.7,
        maxTokens: 4096
      }
      const result = service.create(input)
      expect(repos.aiProviders.create).toHaveBeenCalledTimes(1)
      const callArg = (repos.aiProviders.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg.name).toBe('OpenAI')
      expect(callArg.model).toBe('gpt-4o')
      expect(callArg.models).toEqual(['gpt-4o', 'gpt-5'])
      expect(callArg.baseModel).toBe('gpt-4o')
      expect(callArg.variant).toBe('')
      expect(callArg.variantFormat).toBe('dash')
      expect(callArg.apiKeyEnc).toBeInstanceOf(Buffer)
      expect(callArg.temperature).toBe(0.7)
      expect(callArg.maxTokens).toBe(4096)
      expect(result.hasKey).toBe(true)
    })

    it('without apiKey: apiKeyEnc is null', () => {
      const input: AiProviderInput = {
        name: 'No Key',
        baseUrl: 'https://api.test.com/v1',
        model: 'gpt-4o'
      }
      service.create(input)
      const callArg = (repos.aiProviders.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg.apiKeyEnc).toBeNull()
    })

    it('with baseModel+variant: model is composed correctly', () => {
      const input: AiProviderInput = {
        name: 'Variant',
        baseUrl: 'https://api.test.com/v1',
        model: '',
        baseModel: 'gpt-4o',
        variant: 'high',
        variantFormat: 'dash'
      }
      service.create(input)
      const callArg = (repos.aiProviders.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg.model).toBe('gpt-4o-high')
      expect(callArg.baseModel).toBe('gpt-4o')
      expect(callArg.variant).toBe('high')
    })

    it('with baseModel+variant and colon format', () => {
      const input: AiProviderInput = {
        name: 'Colon',
        baseUrl: 'https://api.test.com/v1',
        model: '',
        baseModel: 'gpt-4o',
        variant: 'high',
        variantFormat: 'colon'
      }
      service.create(input)
      const callArg = (repos.aiProviders.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg.model).toBe('gpt-4o:high')
    })

    it('uses default temperature/maxTokens as null when not provided', () => {
      const input: AiProviderInput = {
        name: 'Defaults',
        baseUrl: 'https://api.test.com/v1',
        model: 'gpt-4o'
      }
      service.create(input)
      const callArg = (repos.aiProviders.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(callArg.temperature).toBeNull()
      expect(callArg.maxTokens).toBeNull()
    })
  })

  describe('update', () => {
    it('with name patch: only name is updated', () => {
      service.update('p1', { name: 'New Name' })
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.name).toBe('New Name')
      expect(callArg.model).toBeUndefined()
      expect(callArg.apiKeyEnc).toBeUndefined()
    })

    it('with model patch: model fields are re-resolved', () => {
      service.update('p1', { model: '', baseModel: 'claude-3', variant: 'high', variantFormat: 'dash' })
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.model).toBe('claude-3-high')
      expect(callArg.baseModel).toBe('claude-3')
      expect(callArg.variant).toBe('high')
      expect(callArg.variantFormat).toBe('dash')
    })

    it('with apiKey patch: calls encryptKey', () => {
      service.update('p1', { apiKey: 'new-key' })
      expect(mockSafeStorage.encryptString).toHaveBeenCalledWith('new-key')
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.apiKeyEnc).toBeInstanceOf(Buffer)
    })

    it('with temperature patch', () => {
      service.update('p1', { temperature: 0.5 })
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.temperature).toBe(0.5)
    })

    it('with maxTokens patch', () => {
      service.update('p1', { maxTokens: 2048 })
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.maxTokens).toBe(2048)
    })

    it('stores an empty model selection as all models', () => {
      service.update('p1', { models: [' ', ''] })
      const callArg = (repos.aiProviders.update as ReturnType<typeof vi.fn>).mock.calls[0][1]
      expect(callArg.models).toBeNull()
    })

    it('rejects an empty provider name', () => {
      expect(() => service.update('p1', { name: '   ' })).toThrowError(
        expect.objectContaining({ code: 'invalid_input' })
      )
      expect(repos.aiProviders.update).not.toHaveBeenCalled()
    })

    it('rejects an empty model', () => {
      expect(() => service.update('p1', {
        model: '',
        baseModel: '',
        variant: ''
      })).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
      expect(repos.aiProviders.update).not.toHaveBeenCalled()
    })

    it('when provider not found: throws RepoError not_found', () => {
      expect(() => service.update('nonexistent', { name: 'x' })).toThrow(RepoError)
      try {
        service.update('nonexistent', { name: 'x' })
      } catch (e) {
        expect((e as RepoError).code).toBe('not_found')
      }
    })
  })

  describe('remove', () => {
    it('delegates to repos.delete', () => {
      service.remove('p1')
      expect(repos.aiProviders.delete).toHaveBeenCalledWith('p1')
    })
  })

  describe('getProvider', () => {
    it('returns mapped provider (hasKey=true when apiKeyEnc != null)', () => {
      const provider = service.getProvider('p1')
      expect(provider.id).toBe('p1')
      expect(provider.hasKey).toBe(true)
    })

    it('returns mapped provider (hasKey=false when apiKeyEnc is null)', () => {
      const mockRepo = makeMockRepo({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: null }))
      })
      repos = makeMockRepos()
      ;(repos as unknown as { aiProviders: AiProvidersRepo }).aiProviders = mockRepo
      service = createAiProvidersService(repos)
      const provider = service.getProvider('p1')
      expect(provider.hasKey).toBe(false)
    })

    it('not found: throws RepoError', () => {
      expect(() => service.getProvider('nonexistent')).toThrow(RepoError)
      try {
        service.getProvider('nonexistent')
      } catch (e) {
        expect((e as RepoError).code).toBe('not_found')
      }
    })
  })

  describe('getDecryptedKey', () => {
    it('returns decrypted key', () => {
      const key = service.getDecryptedKey('p1')
      expect(key).toBe('secret-key')
      expect(mockSafeStorage.decryptString).toHaveBeenCalled()
    })

    it('throws when provider not found', () => {
      expect(() => service.getDecryptedKey('nonexistent')).toThrow(RepoError)
    })

    it('throws no_api_key when apiKeyEnc is null', () => {
      const mockRepo = makeMockRepo({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: null }))
      })
      repos = makeMockRepos()
      ;(repos as unknown as { aiProviders: AiProvidersRepo }).aiProviders = mockRepo
      service = createAiProvidersService(repos)
      expect(() => service.getDecryptedKey('p1')).toThrow(RepoError)
      try {
        service.getDecryptedKey('p1')
      } catch (e) {
        expect((e as RepoError).code).toBe('no_api_key')
      }
    })
  })

  describe('test', () => {
    it('success: net.fetch returns ok response with models', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] })
      })
      const result = await service.test('p1')
      expect(result.ok).toBe(true)
      expect(result.models).toEqual(['gpt-4o', 'gpt-3.5-turbo'])
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('/models')
    })

    it('HTTP error: returns { ok: false }', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({})
      })
      const result = await service.test('p1')
      expect(result.ok).toBe(false)
    })

    it('network error: returns { ok: false }', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))
      const result = await service.test('p1')
      expect(result.ok).toBe(false)
    })

    it('provider not found: returns { ok: false }', async () => {
      const result = await service.test('nonexistent')
      expect(result.ok).toBe(false)
    })

    it('provider has no API key: returns { ok: false }', async () => {
      const mockRepo = makeMockRepo({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: null }))
      })
      repos = makeMockRepos()
      ;(repos as unknown as { aiProviders: AiProvidersRepo }).aiProviders = mockRepo
      service = createAiProvidersService(repos)
      const result = await service.test('p1')
      expect(result.ok).toBe(false)
    })
  })

  describe('listModels', () => {
    it('with providerId: uses provider baseUrl and decrypted key', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'gpt-4o' }] })
      })
      const result = await service.listModels({ providerId: 'p1' })
      expect(result.ok).toBe(true)
      expect(result.models).toHaveLength(1)
      expect(result.models[0].id).toBe('gpt-4o')
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const fetchOpts = mockFetch.mock.calls[0][1] as { headers: Record<string, string> }
      expect(fetchOpts.headers.Authorization).toBe('Bearer secret-key')
    })

    it('with providerId but no API key: returns { ok: false, error: Provider has no API key }', async () => {
      const mockRepo = makeMockRepo({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: null }))
      })
      repos = makeMockRepos()
      ;(repos as unknown as { aiProviders: AiProvidersRepo }).aiProviders = mockRepo
      service = createAiProvidersService(repos)
      const result = await service.listModels({ providerId: 'p1' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Provider has no API key')
    })

    it('with providerId not found: returns { ok: false, error: Provider not found }', async () => {
      const result = await service.listModels({ providerId: 'nonexistent' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Provider not found')
    })

    it('with explicit baseUrl+apiKey: uses those directly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'model-a' }] })
      })
      const result = await service.listModels({
        baseUrl: 'https://custom.api.com/v1',
        apiKey: 'custom-key'
      })
      expect(result.ok).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toContain('https://custom.api.com/v1/models')
      const fetchOpts = mockFetch.mock.calls[0][1] as { headers: Record<string, string> }
      expect(fetchOpts.headers.Authorization).toBe('Bearer custom-key')
    })

    it('missing baseUrl: returns { ok: false, error: Base URL is required }', async () => {
      const result = await service.listModels({ apiKey: 'key' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Base URL is required')
    })

    it('missing apiKey: returns { ok: false, error: API key is required }', async () => {
      const result = await service.listModels({
        presetId: 'openai',
        baseUrl: 'https://api.test.com/v1'
      })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('API key is required')
    })

    it('fetch fails: returns { ok: false, error: ... }', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))
      const result = await service.listModels({
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'key'
      })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Connection refused')
    })

    it('strips trailing slashes from baseUrl', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] })
      })
      await service.listModels({
        baseUrl: 'https://api.test.com/v1///',
        apiKey: 'key'
      })
      const url = mockFetch.mock.calls[0][0] as string
      expect(url).toBe('https://api.test.com/v1/models')
    })

    it('HTTP error: returns { ok: false, error: HTTP status }', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({})
      })
      const result = await service.listModels({
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'key'
      })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('HTTP 500')
    })
  })
})
