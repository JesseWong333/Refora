import { describe, it, expect } from 'vitest'
import { validatePatch } from '../../src/main/db/repositories/documents'
import { RepoError } from '../../src/main/db/repositories/errors'
import type { DocumentPatch } from '../../src/shared/ipc-types'

function expectForbiddenField(patch: Record<string, unknown>, field: string): void {
  let caught: unknown
  try {
    validatePatch(patch as DocumentPatch)
  } catch (e) {
    caught = e
  }
  expect(caught).toBeInstanceOf(RepoError)
  const err = caught as RepoError
  expect(err.code).toBe('forbidden_field')
  expect(err.field).toBe(field)
}

describe('patch whitelist (real validatePatch from documents repository)', () => {
  it('accepts editable fields and returns them', () => {
    expect(validatePatch({ title: 'a', doi: '10.1/x', arxivId: '2401.12345' })).toEqual([
      'title',
      'doi',
      'arxivId'
    ])
  })

  it('rejects id', () => {
    expectForbiddenField({ id: 'x' }, 'id')
  })

  it('rejects filePath and starred', () => {
    expectForbiddenField({ filePath: '/a' }, 'filePath')
    expectForbiddenField({ starred: 1 }, 'starred')
  })

  it('accepts an empty patch', () => {
    expect(validatePatch({})).toEqual([])
  })

  it('rejects on the first forbidden field', () => {
    expectForbiddenField({ title: 'ok', addedAt: 1 }, 'addedAt')
  })

  it('rejects every non-editable system field', () => {
    const forbidden = [
      'id',
      'filePath',
      'originalFolderPath',
      'fileName',
      'fileSize',
      'fileHash',
      'addedAt',
      'lastReadAt',
      'starred',
      'metadataSource',
      'metadataStatus',
      'metadataAttempts',
      'editedFields',
      'remoteValues',
      'fileMissing'
    ]
    for (const key of forbidden) {
      expectForbiddenField({ [key]: 'x' }, key)
    }
  })
})
