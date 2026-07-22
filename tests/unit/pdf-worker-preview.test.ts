import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'

afterEach(() => {
  vi.doUnmock('@napi-rs/canvas')
  vi.doUnmock('pdfjs-dist/legacy/build/pdf.mjs')
  vi.resetModules()
})

describe('PDF worker preview', () => {
  it('renders the first PDF page as a bounded PNG', async () => {
    const { renderPdfPreview } = await import('../../src/main/worker/pdf-worker')
    const preview = await renderPdfPreview(resolve('tests/fixtures/valid.pdf'))

    expect(Array.from(preview.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(preview.length).toBeGreaterThan(100)
  })

  it('releases the PDF page, loading task, and native canvas after rendering', async () => {
    const cleanup = vi.fn(() => true)
    const destroy = vi.fn(async () => {})
    const canvas = {
      width: 320,
      height: 640,
      getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn() })),
      toBuffer: vi.fn(() => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]))
    }
    vi.doMock('@napi-rs/canvas', () => ({
      createCanvas: vi.fn(() => canvas),
      DOMMatrix: class {},
      Path2D: class {}
    }))
    vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
      GlobalWorkerOptions: {},
      getDocument: vi.fn(() => ({
        promise: Promise.resolve({
          getPage: vi.fn(async () => ({
            cleanup,
            getViewport: ({ scale }: { scale: number }) => ({
              width: 100 * scale,
              height: 200 * scale
            }),
            render: vi.fn(() => ({ promise: Promise.resolve() }))
          }))
        }),
        destroy
      }))
    }))
    const { renderPdfPreview } = await import('../../src/main/worker/pdf-worker')

    await expect(renderPdfPreview(resolve('tests/fixtures/valid.pdf'))).resolves.toBeInstanceOf(Uint8Array)

    expect(cleanup).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
  })
})
