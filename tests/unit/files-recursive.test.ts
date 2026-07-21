import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ shell: {} }))

describe('findPdfsRecursively', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'refora-pdf-scan-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('skips PDFs stored in managed workspace asset and agent directories', async () => {
    const assetDirectory = join(directory, 'refora-assets', 'asset-1')
    const agentDirectory = join(directory, '.refora-agent', 'workspaces', 'workspace-1')
    mkdirSync(assetDirectory, { recursive: true })
    mkdirSync(agentDirectory, { recursive: true })
    writeFileSync(join(directory, 'library-paper.pdf'), 'pdf')
    writeFileSync(join(assetDirectory, 'attachment.pdf'), 'pdf')
    writeFileSync(join(agentDirectory, 'generated.pdf'), 'pdf')
    const { findPdfsRecursively } = await import('../../src/main/services/files')

    expect(await findPdfsRecursively(directory)).toEqual([join(directory, 'library-paper.pdf')])
  })
})
