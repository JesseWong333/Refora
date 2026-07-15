import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

const { mockExistsSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<[string], boolean>(),
  mockReadFileSync: vi.fn<[string, string], string>(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn()
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync
  }
}))

import { readLibraryFolderPath, writeLibraryFolderPath } from '../../src/main/services/prefs'

describe('prefs helpers', () => {
  beforeEach(() => {
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
    mockWriteFileSync.mockReset()
    mockMkdirSync.mockReset()
  })

  it('readLibraryFolderPath returns empty string when no prefs file', () => {
    mockExistsSync.mockReturnValue(false)
    expect(readLibraryFolderPath('/ud')).toBe('')
  })

  it('readLibraryFolderPath reads libraryFolderPath from prefs json', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ libraryFolderPath: '/my/lib' }))
    expect(readLibraryFolderPath('/ud')).toBe('/my/lib')
    expect(mockReadFileSync).toHaveBeenCalledWith(join('/ud', 'refora-prefs.json'), 'utf-8')
  })

  it('readLibraryFolderPath returns empty on malformed json', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{ not json')
    expect(readLibraryFolderPath('/ud')).toBe('')
  })

  it('writeLibraryFolderPath writes json with the folder', () => {
    mockExistsSync.mockReturnValue(true)
    writeLibraryFolderPath('/ud', '/my/lib')
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    const [path, content] = mockWriteFileSync.mock.calls[0]
    expect(path).toBe(join('/ud', 'refora-prefs.json'))
    expect(JSON.parse(content as string).libraryFolderPath).toBe('/my/lib')
  })

  it('writeLibraryFolderPath creates parent dir when missing', () => {
    mockExistsSync.mockReturnValue(false)
    writeLibraryFolderPath('/ud', '/my/lib')
    expect(mockMkdirSync).toHaveBeenCalled()
  })
})