import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StructuredDocumentPanel from '../../src/renderer/components/StructuredDocumentPanel'
import { useOcrReaderStore } from '../../src/renderer/store/ocrReaderStore'
import type { ReforaApi } from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const api = (window as unknown as { api: ReforaApi }).api

describe('StructuredDocumentPanel', () => {
  beforeEach(() => {
    api.ocr.readMarkdown = vi.fn().mockResolvedValue(
      '![Figure](images/figure.png)\n\n[Source](https://example.com/images/page)'
    )
    api.ocr.assetUrl = vi.fn((_documentId, _resultKey, assetPath) =>
      `refora-document://ocr/doc-1/key-1/${assetPath}`)
    useOcrReaderStore.getState().open('doc-1', 'key-1', 'Paper')
  })

  afterEach(() => {
    cleanup()
    useOcrReaderStore.getState().close()
    vi.restoreAllMocks()
  })

  it('maps only MinerU image paths to managed assets', async () => {
    render(<StructuredDocumentPanel />)

    const image = await screen.findByAltText('Figure')
    expect(image.getAttribute('src')).toBe(
      'refora-document://ocr/doc-1/key-1/assets/figure.png'
    )
    expect(api.ocr.assetUrl).toHaveBeenCalledWith('doc-1', 'key-1', 'assets/figure.png')
    expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute(
      'href',
      'https://example.com/images/page'
    )
  })
})
