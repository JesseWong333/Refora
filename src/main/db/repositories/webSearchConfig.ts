import type { WebSearchProvider } from '../../../shared/webSearch'
import type { SqliteDb } from '../types'
import { RepoError } from './errors'

export interface WebSearchConfigRow {
  provider: WebSearchProvider
  tavilyApiKeyEnc: Buffer | null
  braveApiKeyEnc: Buffer | null
  updatedAt: number
}

export interface WebSearchConfigUpdate {
  provider?: WebSearchProvider
  tavilyApiKeyEnc?: Buffer | null
  braveApiKeyEnc?: Buffer | null
}

export function createWebSearchConfigRepository(db: SqliteDb) {
  function buffer(value: unknown): Buffer | null {
    if (value == null) return null
    if (Buffer.isBuffer(value)) return value
    if (value instanceof Uint8Array) return Buffer.from(value)
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      )
    }
    if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
      return Buffer.from(value)
    }
    throw new RepoError('invalid_data', 'Stored web search API key has an invalid format')
  }

  function get(): WebSearchConfigRow {
    const row = db.prepare(
      `SELECT provider, tavilyApiKeyEnc, braveApiKeyEnc, updatedAt
       FROM web_search_config
       WHERE id = 1`
    ).get() as WebSearchConfigRow | undefined
    if (!row) throw new RepoError('not_found', 'Web search configuration is missing')
    return {
      provider: row.provider,
      tavilyApiKeyEnc: buffer(row.tavilyApiKeyEnc),
      braveApiKeyEnc: buffer(row.braveApiKeyEnc),
      updatedAt: row.updatedAt
    }
  }

  function update(input: WebSearchConfigUpdate): WebSearchConfigRow {
    const sets: string[] = []
    const params: unknown[] = []
    if (input.provider !== undefined) {
      sets.push('provider = ?')
      params.push(input.provider)
    }
    if (input.tavilyApiKeyEnc !== undefined) {
      sets.push('tavilyApiKeyEnc = ?')
      params.push(input.tavilyApiKeyEnc)
    }
    if (input.braveApiKeyEnc !== undefined) {
      sets.push('braveApiKeyEnc = ?')
      params.push(input.braveApiKeyEnc)
    }
    if (sets.length === 0) return get()
    sets.push('updatedAt = ?')
    params.push(Date.now(), 1)
    db.prepare(`UPDATE web_search_config SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return get()
  }

  return { get, update }
}

export type WebSearchConfigRepository = ReturnType<typeof createWebSearchConfigRepository>
