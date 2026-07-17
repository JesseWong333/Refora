import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  writeFileToClipboard,
  writeMarkdownFileToClipboard,
  writeTextToClipboard
} from '../../src/main/services/clipboard'

const electronMocks = vi.hoisted(() => ({
  writeBuffer: vi.fn(),
  writeText: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {
    writeBuffer: electronMocks.writeBuffer,
    writeText: electronMocks.writeText
  }
}))

describe('clipboard service', () => {
  const cleanupPaths: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const path of cleanupPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('writes a regular file as a macOS file-list pasteboard value', () => {
    const directory = mkdtempSync(join(tmpdir(), 'refora-clipboard-source-'))
    cleanupPaths.push(directory)
    const filePath = join(directory, 'paper & notes.pdf')
    writeFileSync(filePath, 'pdf')

    writeFileToClipboard(filePath)

    expect(electronMocks.writeBuffer).toHaveBeenCalledOnce()
    const [format, buffer] = electronMocks.writeBuffer.mock.calls[0] as [string, Buffer]
    expect(format).toBe('NSFilenamesPboardType')
    expect(buffer.toString('utf8')).toContain(`${directory}/paper &amp; notes.pdf`)
  })

  it('creates a named Markdown file and copies the file reference', () => {
    const filePath = writeMarkdownFileToClipboard('Research: notes.md', '# Research\n\nBody\n')
    cleanupPaths.push(dirname(filePath))

    expect(filePath).toMatch(/Research- notes\.md$/)
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, 'utf8')).toBe('# Research\n\nBody\n')
    expect(electronMocks.writeBuffer).toHaveBeenCalledOnce()
  })

  it('writes sticky-note content as plain text', () => {
    writeTextToClipboard('Current draft')
    expect(electronMocks.writeText).toHaveBeenCalledWith('Current draft')
  })
})
