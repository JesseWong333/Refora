import { describe, it, expect } from 'vitest'

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function err<T = never>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}

describe('Result<T> envelope', () => {
  it('ok carries data and discriminates true', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe(42)
    }
  })

  it('err carries code + message and discriminates false', () => {
    const r = err('not_found', 'document missing')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('not_found')
      expect(r.error.message).toBe('document missing')
    }
  })

  it('narrows via the ok flag in a union', () => {
    const r: Result<string> = err<string>('forbidden_field', 'no')
    const out = r.ok ? r.data.toUpperCase() : r.error.code
    expect(out).toBe('forbidden_field')
  })
})
