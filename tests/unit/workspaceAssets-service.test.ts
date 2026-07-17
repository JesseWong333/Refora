import { describe, expect, it } from 'vitest'
import { workspaceAssetMediaType } from '../../src/main/services/workspaceAssets'

describe('workspace asset preview classification', () => {
  it.each([
    ['photo.PNG', 'image/png', 'image'],
    ['sound.mp3', 'audio/mpeg', 'audio'],
    ['clip.mov', 'video/quicktime', 'video'],
    ['notes.md', 'text/markdown', 'text'],
    ['data.json', 'application/json', 'text'],
    ['script.ts', 'text/plain', 'text'],
    ['archive.zip', 'application/octet-stream', 'none'],
    ['paper.pdf', 'application/pdf', 'none']
  ] as const)('classifies %s as %s with %s preview', (fileName, mimeType, previewKind) => {
    expect(workspaceAssetMediaType(fileName)).toEqual({ mimeType, previewKind })
  })
})
