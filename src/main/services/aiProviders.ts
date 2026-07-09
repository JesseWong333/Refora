import { safeStorage, net } from 'electron'
import type { Repositories } from '../db/repositories'
import type {
  AiProvider,
  AiProviderInput,
  AiProviderPatch,
  ListModelsRequest,
  ListModelsResult,
  ModelVariantFormat
} from '../../shared/ipc-types'
import {
  composeModelId,
  normalizeModelList,
  parseModelId
} from '../../shared/modelVariant'
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

function asFormat(v: unknown): ModelVariantFormat {
  if (v === 'colon' || v === 'none' || v === 'dash') return v
  return 'dash'
}

function resolveModelFields(input: {
  model?: string
  baseModel?: string
  variant?: string
  variantFormat?: ModelVariantFormat
}): {
  model: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
} {
  const variantFormat = asFormat(input.variantFormat)
  if (input.baseModel != null && input.baseModel.trim()) {
    const baseModel = input.baseModel.trim()
    const variant = (input.variant ?? '').trim()
    const model =
      input.model?.trim() || composeModelId(baseModel, variant, variantFormat)
    return { model, baseModel, variant, variantFormat }
  }
  const model = (input.model ?? '').trim()
  const parsed = parseModelId(model)
  const baseModel = parsed.baseModel || model
  const variant = input.variant != null ? input.variant.trim() : parsed.variant
  const composed = composeModelId(baseModel, variant, variantFormat)
  return {
    model: composed || model,
    baseModel,
    variant,
    variantFormat
  }
}

function mapRaw(row: {
  id: string
  name: string
  baseUrl: string
  model: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
  apiKeyEnc: Buffer | null
  createdAt: number
}): AiProvider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    baseModel: row.baseModel,
    variant: row.variant,
    variantFormat: row.variantFormat,
    hasKey: row.apiKeyEnc != null,
    createdAt: row.createdAt
  }
}

async function fetchModelsFromEndpoint(
  baseUrl: string,
  apiKey: string
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    const base = baseUrl.replace(/\/+$/, '')
    const response = await net.fetch(`${base}/models`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` }
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === 'string')
    return { ok: true, models }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export function createAiProvidersService(repos: Repositories) {
  function list(): AiProvider[] {
    return repos.aiProviders.list()
  }

  function create(input: AiProviderInput): AiProvider {
    const fields = resolveModelFields(input)
    const apiKeyEnc = encryptKey(input.apiKey)
    return repos.aiProviders.create({
      name: input.name,
      baseUrl: input.baseUrl,
      model: fields.model,
      baseModel: fields.baseModel,
      variant: fields.variant,
      variantFormat: fields.variantFormat,
      apiKeyEnc
    })
  }

  function update(id: string, patch: AiProviderPatch): AiProvider {
    const existing = repos.aiProviders.getRaw(id)
    if (!existing) throw new RepoError('not_found', `provider not found: ${id}`)

    const fields =
      patch.model !== undefined ||
      patch.baseModel !== undefined ||
      patch.variant !== undefined ||
      patch.variantFormat !== undefined
        ? resolveModelFields({
            model: patch.model ?? existing.model,
            baseModel: patch.baseModel ?? existing.baseModel,
            variant: patch.variant ?? existing.variant,
            variantFormat: patch.variantFormat ?? existing.variantFormat
          })
        : null

    const updateInput: {
      name?: string
      baseUrl?: string
      model?: string
      baseModel?: string
      variant?: string
      variantFormat?: ModelVariantFormat
      apiKeyEnc?: Buffer | null
    } = {
      name: patch.name,
      baseUrl: patch.baseUrl
    }
    if (fields) {
      updateInput.model = fields.model
      updateInput.baseModel = fields.baseModel
      updateInput.variant = fields.variant
      updateInput.variantFormat = fields.variantFormat
    }
    if (patch.apiKey !== undefined) {
      updateInput.apiKeyEnc = encryptKey(patch.apiKey)
    }
    return repos.aiProviders.update(id, updateInput)
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
      const result = await fetchModelsFromEndpoint(raw.baseUrl, key)
      if (!result.ok) return { ok: false }
      return { ok: true, models: result.models }
    } catch (e) {
      logger.warn(`aiProviders:test failed: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false }
    }
  }

  async function listModels(req: ListModelsRequest): Promise<ListModelsResult> {
    try {
      let baseUrl = (req.baseUrl ?? '').trim()
      let apiKey = (req.apiKey ?? '').trim()
      let providerName: string | undefined

      if (req.providerId) {
        const raw = repos.aiProviders.getRaw(req.providerId)
        if (!raw) {
          return { ok: false, models: [], error: 'Provider not found' }
        }
        providerName = raw.name
        if (!baseUrl) baseUrl = raw.baseUrl
        if (!apiKey) {
          try {
            apiKey = decryptKey(raw.apiKeyEnc)
          } catch {
            return { ok: false, models: [], error: 'Provider has no API key' }
          }
        }
      }

      if (!baseUrl) {
        return { ok: false, models: [], error: 'Base URL is required' }
      }
      if (!apiKey) {
        return { ok: false, models: [], error: 'API key is required' }
      }

      const result = await fetchModelsFromEndpoint(baseUrl, apiKey)
      if (!result.ok) {
        return { ok: false, models: [], error: result.error }
      }
      return {
        ok: true,
        models: normalizeModelList(result.models, providerName)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.warn(`aiProviders:listModels failed: ${msg}`)
      return { ok: false, models: [], error: msg }
    }
  }

  return { list, create, update, remove, test, listModels, getProvider, getDecryptedKey }
}

export type AiProvidersService = ReturnType<typeof createAiProvidersService>
