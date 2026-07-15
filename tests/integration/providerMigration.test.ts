import { describe, expect, it } from 'vitest'
import { loadMigrationFiles } from '../../src/main/db/migrations'

describe('AI provider profile migration', () => {
  it('adds protocol and reasoning fields and classifies existing endpoints', () => {
    const migration = loadMigrationFiles().find((item) => item.version === 13)
    expect(migration).toBeDefined()
    expect(migration!.sql).toContain('ADD COLUMN presetId')
    expect(migration!.sql).toContain('ADD COLUMN apiProtocol')
    expect(migration!.sql).toContain('ADD COLUMN reasoningControl')
    expect(migration!.sql).toContain('ADD COLUMN reasoningEffort')
    expect(migration!.sql).toContain("THEN 'openai-responses'")
    expect(migration!.sql).toContain("THEN 'deepseek'")
    expect(migration!.sql).toContain("THEN 'ollama-local'")
  })
})
