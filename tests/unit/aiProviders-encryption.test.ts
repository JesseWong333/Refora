import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAiProvidersService } from '../../src/main/services/aiProviders'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { AiProviderRawRow } from '../../src/main/db/repositories/aiProviders'
import type { Repositories } from '../../src/main/db/repositories'
import type { AiProvider, ModelVariantFormat } from '../../src/shared/ipc-types'

const { mockIsEncryptionAvailable, mockEncryptString, mockDecryptString } = vi.hoisted(() => ({
  mockIsEncryptionAvailable: vi.fn(),
  mockEncryptString: vi.fn(),
  mockDecryptString: vi.fn()
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mockIsEncryptionAvailable,
    encryptString: mockEncryptString,
    decryptString: mockDecryptString
  },
  net: {
    fetch: vi.fn()
  }
}))

vi.mock('../../src/main/services/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
}))

function makeProvider(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    id: 'p1',
    name: 'test',
    baseUrl: 'http://x',
    model: 'm',
    baseModel: 'm',
    variant: '',
    variantFormat: 'dash',
    hasKey: true,
    temperature: null,
    maxTokens: null,
    createdAt: 0,
    ...overrides
  }
}

function makeRawRow(overrides: Partial<AiProviderRawRow> = {}): AiProviderRawRow {
  return {
    id: 'p1',
    name: 'test',
    baseUrl: 'http://x',
    model: 'm',
    baseModel: 'm',
    variant: '',
    variantFormat: 'dash' as ModelVariantFormat,
    apiKeyEnc: Buffer.from('encrypted'),
    temperature: null,
    maxTokens: null,
    createdAt: 0,
    ...overrides
  }
}

function makeMockRepos(
  overrides: Partial<Repositories['aiProviders']> = {}
): Repositories {
  return {
    aiProviders: {
      list: vi.fn(() => []),
      create: vi.fn(() => makeProvider()),
      update: vi.fn(() => makeProvider()),
      getRaw: vi.fn(() => makeRawRow()),
      delete: vi.fn(),
      ...overrides
    }
  } as unknown as Repositories
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('aiProviders encryption', () => {
  describe('when safeStorage is unavailable', () => {
    beforeEach(() => {
      mockIsEncryptionAvailable.mockReturnValue(false)
    })

    it('create throws RepoError with code encryption_unavailable', () => {
      const repos = makeMockRepos()
      const service = createAiProvidersService(repos)

      expect(() =>
        service.create({
          name: 'test',
          baseUrl: 'http://x',
          model: 'm',
          apiKey: 'sk-xxx',
          baseModel: 'm',
          variant: '',
          variantFormat: 'dash'
        })
      ).toThrow(RepoError)

      try {
        service.create({
          name: 'test',
          baseUrl: 'http://x',
          model: 'm',
          apiKey: 'sk-xxx',
          baseModel: 'm',
          variant: '',
          variantFormat: 'dash'
        })
      } catch (e) {
        expect((e as RepoError).code).toBe('encryption_unavailable')
      }
    })

    it('update with apiKey throws RepoError with code encryption_unavailable', () => {
      const repos = makeMockRepos()
      const service = createAiProvidersService(repos)

      expect(() => service.update('p1', { apiKey: 'sk-xxx' })).toThrow(RepoError)

      try {
        service.update('p1', { apiKey: 'sk-xxx' })
      } catch (e) {
        expect((e as RepoError).code).toBe('encryption_unavailable')
      }
    })

    it('getDecryptedKey throws RepoError with code encryption_unavailable', () => {
      const repos = makeMockRepos({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: Buffer.from('some-enc') }))
      })
      const service = createAiProvidersService(repos)

      expect(() => service.getDecryptedKey('p1')).toThrow(RepoError)

      try {
        service.getDecryptedKey('p1')
      } catch (e) {
        expect((e as RepoError).code).toBe('encryption_unavailable')
      }
    })

    it('create without apiKey does not throw (null key needs no encryption)', () => {
      const repos = makeMockRepos()
      const service = createAiProvidersService(repos)

      expect(() =>
        service.create({
          name: 'test',
          baseUrl: 'http://x',
          model: 'm',
          baseModel: 'm',
          variant: '',
          variantFormat: 'dash'
        })
      ).not.toThrow()

      expect(mockEncryptString).not.toHaveBeenCalled()
    })
  })

  describe('when safeStorage is available', () => {
    beforeEach(() => {
      mockIsEncryptionAvailable.mockReturnValue(true)
      mockEncryptString.mockReturnValue(Buffer.from('encrypted-key'))
      mockDecryptString.mockReturnValue('decrypted-key')
    })

    it('create calls safeStorage.encryptString with the api key', () => {
      const repos = makeMockRepos()
      const service = createAiProvidersService(repos)

      service.create({
        name: 'test',
        baseUrl: 'http://x',
        model: 'm',
        apiKey: 'sk-xxx',
        baseModel: 'm',
        variant: '',
        variantFormat: 'dash'
      })

      expect(mockEncryptString).toHaveBeenCalledWith('sk-xxx')
    })

    it('getDecryptedKey calls safeStorage.decryptString with the stored buffer', () => {
      const encBuffer = Buffer.from('stored-enc')
      const repos = makeMockRepos({
        getRaw: vi.fn(() => makeRawRow({ apiKeyEnc: encBuffer }))
      })
      const service = createAiProvidersService(repos)

      const key = service.getDecryptedKey('p1')

      expect(mockDecryptString).toHaveBeenCalledWith(encBuffer)
      expect(key).toBe('decrypted-key')
    })

    it('update with apiKey calls safeStorage.encryptString', () => {
      const repos = makeMockRepos()
      const service = createAiProvidersService(repos)

      service.update('p1', { apiKey: 'sk-new' })

      expect(mockEncryptString).toHaveBeenCalledWith('sk-new')
    })
  })
})
