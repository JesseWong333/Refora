import { randomUUID } from 'node:crypto'
import type {
  AiApiProtocol,
  AiProvider,
  AiReasoningControl,
  AiReasoningEffort,
  ModelVariantFormat
} from '../../../shared/ipc-types'
import { composeModelId, parseModelId } from '../../../shared/modelVariant'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

export interface AiProviderRawRow {
  id: string
  presetId: string
  name: string
  baseUrl: string
  apiProtocol: AiApiProtocol
  reasoningControl: AiReasoningControl
  reasoningEffort: AiReasoningEffort
  model: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
  apiKeyEnc: Buffer | null
  temperature: number | null
  maxTokens: number | null
  createdAt: number
}

export interface AiProviderCreateInput {
  presetId: string
  name: string
  baseUrl: string
  apiProtocol: AiApiProtocol
  reasoningControl: AiReasoningControl
  reasoningEffort: AiReasoningEffort
  model: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
  apiKeyEnc: Buffer | null
  temperature: number | null
  maxTokens: number | null
}

export interface AiProviderUpdateInput {
  presetId?: string
  name?: string
  baseUrl?: string
  apiProtocol?: AiApiProtocol
  reasoningControl?: AiReasoningControl
  reasoningEffort?: AiReasoningEffort
  model?: string
  baseModel?: string
  variant?: string
  variantFormat?: ModelVariantFormat
  apiKeyEnc?: Buffer | null
  temperature?: number | null
  maxTokens?: number | null
}

function asFormat(v: unknown): ModelVariantFormat {
  if (v === 'colon' || v === 'none' || v === 'dash') return v
  return 'dash'
}

function mapProvider(row: Record<string, unknown>): AiProvider {
  const model = (row.model as string) || ''
  const parsed = parseModelId(model)
  const baseModel = (row.baseModel as string | null) || parsed.baseModel || model
  const variant = (row.variant as string | null) ?? parsed.variant ?? ''
  const variantFormat = asFormat(row.variantFormat)
  return {
    id: row.id as string,
    presetId: (row.presetId as string | null) || 'custom',
    name: row.name as string,
    baseUrl: row.baseUrl as string,
    apiProtocol:
      row.apiProtocol === 'openai-responses' ? 'openai-responses' : 'openai-compatible',
    reasoningControl:
      row.reasoningControl === 'thinking' ||
      row.reasoningControl === 'enable-thinking' ||
      row.reasoningControl === 'none'
        ? row.reasoningControl
        : 'openai',
    reasoningEffort:
      row.reasoningEffort === 'none' ||
      row.reasoningEffort === 'minimal' ||
      row.reasoningEffort === 'low' ||
      row.reasoningEffort === 'high' ||
      row.reasoningEffort === 'xhigh' ||
      row.reasoningEffort === 'max'
        ? row.reasoningEffort
        : 'medium',
    model: model || composeModelId(baseModel, variant, variantFormat),
    baseModel,
    variant,
    variantFormat,
    temperature: (row.temperature as number | null) ?? null,
    maxTokens: (row.maxTokens as number | null) ?? null,
    hasKey: row.apiKeyEnc != null,
    createdAt: row.createdAt as number
  }
}

function mapRaw(row: Record<string, unknown>): AiProviderRawRow {
  const mapped = mapProvider(row)
  return {
    id: mapped.id,
    presetId: mapped.presetId,
    name: mapped.name,
    baseUrl: mapped.baseUrl,
    apiProtocol: mapped.apiProtocol,
    reasoningControl: mapped.reasoningControl,
    reasoningEffort: mapped.reasoningEffort,
    model: mapped.model,
    baseModel: mapped.baseModel,
    variant: mapped.variant,
    variantFormat: mapped.variantFormat,
    temperature: mapped.temperature,
    maxTokens: mapped.maxTokens,
    apiKeyEnc: (row.apiKeyEnc as Buffer | null) ?? null,
    createdAt: mapped.createdAt
  }
}

export function createAiProvidersRepository(db: SqliteDb) {
  function list(): AiProvider[] {
    const rows = db.prepare('SELECT * FROM ai_providers ORDER BY createdAt').all() as Record<
      string,
      unknown
    >[]
    return rows.map(mapProvider)
  }

  function getRaw(id: string): AiProviderRawRow | null {
    const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    return mapRaw(row)
  }

  function create(input: AiProviderCreateInput): AiProvider {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      `INSERT INTO ai_providers
        (id, presetId, name, baseUrl, apiProtocol, reasoningControl, reasoningEffort, model, baseModel, variant, variantFormat, apiKeyEnc, temperature, maxTokens, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.presetId,
      input.name,
      input.baseUrl,
      input.apiProtocol,
      input.reasoningControl,
      input.reasoningEffort,
      input.model,
      input.baseModel,
      input.variant,
      input.variantFormat,
      input.apiKeyEnc,
      input.temperature,
      input.maxTokens,
      now
    )
    const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapProvider(row)
  }

  function update(id: string, input: AiProviderUpdateInput): AiProvider {
    const sets: string[] = []
    const params: unknown[] = []
    if (input.presetId !== undefined) {
      sets.push('presetId = ?')
      params.push(input.presetId)
    }
    if (input.name !== undefined) {
      sets.push('name = ?')
      params.push(input.name)
    }
    if (input.baseUrl !== undefined) {
      sets.push('baseUrl = ?')
      params.push(input.baseUrl)
    }
    if (input.apiProtocol !== undefined) {
      sets.push('apiProtocol = ?')
      params.push(input.apiProtocol)
    }
    if (input.reasoningControl !== undefined) {
      sets.push('reasoningControl = ?')
      params.push(input.reasoningControl)
    }
    if (input.reasoningEffort !== undefined) {
      sets.push('reasoningEffort = ?')
      params.push(input.reasoningEffort)
    }
    if (input.model !== undefined) {
      sets.push('model = ?')
      params.push(input.model)
    }
    if (input.baseModel !== undefined) {
      sets.push('baseModel = ?')
      params.push(input.baseModel)
    }
    if (input.variant !== undefined) {
      sets.push('variant = ?')
      params.push(input.variant)
    }
    if (input.variantFormat !== undefined) {
      sets.push('variantFormat = ?')
      params.push(input.variantFormat)
    }
    if (input.apiKeyEnc !== undefined) {
      sets.push('apiKeyEnc = ?')
      params.push(input.apiKeyEnc)
    }
    if (input.temperature !== undefined) {
      sets.push('temperature = ?')
      params.push(input.temperature)
    }
    if (input.maxTokens !== undefined) {
      sets.push('maxTokens = ?')
      params.push(input.maxTokens)
    }
    if (sets.length === 0) {
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      if (!row) throw new RepoError('not_found', `provider not found: ${id}`)
      return mapProvider(row)
    }
    params.push(id)
    const result = db.prepare(`UPDATE ai_providers SET ${sets.join(', ')} WHERE id = ?`).run(
      ...params
    )
    if (result.changes === 0) throw new RepoError('not_found', `provider not found: ${id}`)
    const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapProvider(row)
  }

  function remove(id: string): void {
    const result = db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id)
    if (result.changes === 0) throw new RepoError('not_found', `provider not found: ${id}`)
  }

  return { list, getRaw, create, update, delete: remove }
}
