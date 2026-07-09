import { safeStorage, net } from 'electron'
import type { Repositories } from '../db/repositories'
import type { AiProvider, AiProviderInput, AiProviderPatch } from '../../shared/ipc-types'
import { RepoError } from '../db/repositories/errors'
import { logger } from './logger'

const TEST_TIMEOUT_MS = 8_000

function encryptKey(apiKey: string | undefined): Buffer | null {
  if (!apiKey) return null
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(apiKey)
  }
  logger.warn('safeStorage:encryption-unavailable storing API key as plain buffer')
  return Buffer.from(apiKey)
}

function decryptKey(enc: Buffer | null): string {
  if (!enc) throw new RepoError('no_api_key', 'Provider has no API key')
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(enc)
  }
  return enc.toString()
}

function mapRaw(row: {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKeyEnc: Buffer | null
  createdAt: number
}): AiProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    hasKey: row.apiKeyEnc != null,
    createdAt: row.createdAt
  }
}

export function createAiProvidersService(repos: Repositories) {
  function list(): AiProvider[] {
    return repos.aiProviders.list()
  }

  function create(input: AiProviderInput): AiProvider {
    const apiKeyEnc = encryptKey(input.apiKey)
    return repos.aiProviders.create({
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEnc
    })
  }

  function update(id: string, patch: AiProviderPatch): AiProvider {
    if (patch.apiKey !== undefined) {
      return repos.aiProviders.update(id, {
        name: patch.name,
        baseUrl: patch.baseUrl,
        model: patch.model,
        apiKeyEnc: encryptKey(patch.apiKey)
      })
    }
    return repos.aiProviders.update(id, {
      name: patch.name,
      baseUrl: patch.baseUrl,
      model: patch.model
    })
  }

  function remove(id: string): void {
    repos.aiProviders.delete(id)
  }

  function getProvider(id: string): AiProvider {
    const raw = repos.aiProviders.getRaw(id)
    if (!raw) throw new RepoError('not_found', `provider not found: ${id}`)
    return mapRaw(raw)
  }

  function getDecryptedKey(id: string): string {
    const raw = repos.aiProviders.getRaw(id)
    if (!raw) throw new RepoError('not_found', `provider not found: ${id}`)
    return decryptKey(raw.apiKeyEnc)
  }

  async function test(id: string): Promise<{ ok: boolean; models?: string[] }> {
    try {
      const raw = repos.aiProviders.getRaw(id)
      if (!raw) return { ok: false }
      const key = decryptKey(raw.apiKeyEnc)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
      try {
        const base = raw.baseUrl.replace(/\/+$/, '')
        const response = await net.fetch(`${base}/models`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${key}` }
        })
        if (!response.ok) return { ok: false }
        const body = (await response.json()) as { data?: Array<{ id?: string }> }
        const models = (body.data ?? [])
          .map((m) => m.id)
          .filter((x): x is string => typeof x === 'string')
        return { ok: true, models }
      } finally {
        clearTimeout(timer)
      }
    } catch (e) {
      logger.warn(`aiProviders:test failed: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false }
    }
  }

  return { list, create, update, remove, test, getProvider, getDecryptedKey }
}

export type AiProvidersService = ReturnType<typeof createAiProvidersService>
