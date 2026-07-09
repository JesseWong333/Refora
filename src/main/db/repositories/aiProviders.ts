import { randomUUID } from 'node:crypto'
import type { AiProvider } from '../../../shared/ipc-types'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

export interface AiProviderRawRow {
  id: string
  name: string
  baseUrl: string
  model: string
  apiKeyEnc: Buffer | null
  createdAt: number
}

export interface AiProviderCreateInput {
  name: string
  baseUrl: string
  model: string
  apiKeyEnc: Buffer | null
}

export interface AiProviderUpdateInput {
  name?: string
  baseUrl?: string
  model?: string
  apiKeyEnc?: Buffer | null
}

function mapProvider(row: Record<string, unknown>): AiProvider {
  return {
    id: row.id as string,
    name: row.name as string,
    baseUrl: row.baseUrl as string,
    model: row.model as string,
    hasKey: row.apiKeyEnc != null,
    createdAt: row.createdAt as number
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
    return {
      id: row.id as string,
      name: row.name as string,
      baseUrl: row.baseUrl as string,
      model: row.model as string,
      apiKeyEnc: (row.apiKeyEnc as Buffer | null) ?? null,
      createdAt: row.createdAt as number
    }
  }

  function create(input: AiProviderCreateInput): AiProvider {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(
      'INSERT INTO ai_providers (id, name, baseUrl, model, apiKeyEnc, createdAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, input.name, input.baseUrl, input.model, input.apiKeyEnc, now)
    const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as Record<
      string,
      unknown
    >
    return mapProvider(row)
  }

  function update(id: string, input: AiProviderUpdateInput): AiProvider {
    const sets: string[] = []
    const params: unknown[] = []
    if (input.name !== undefined) {
      sets.push('name = ?')
      params.push(input.name)
    }
    if (input.baseUrl !== undefined) {
      sets.push('baseUrl = ?')
      params.push(input.baseUrl)
    }
    if (input.model !== undefined) {
      sets.push('model = ?')
      params.push(input.model)
    }
    if (input.apiKeyEnc !== undefined) {
      sets.push('apiKeyEnc = ?')
      params.push(input.apiKeyEnc)
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
