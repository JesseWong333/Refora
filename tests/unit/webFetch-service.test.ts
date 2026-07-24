import { describe, expect, it, vi } from 'vitest'
import { fetchWebPage, type WebFetchTransport } from '../../src/main/services/webFetch'

function stream(value: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    }
  })
}

describe('web fetch service', () => {
  it('converts public HTML to bounded Markdown and resolves safe links', async () => {
    const transport = vi.fn<WebFetchTransport>().mockResolvedValue({
      status: 200,
      ok: true,
      url: 'https://example.com/articles/topic',
      headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
      body: stream(`
        <html>
          <head><title>Example Topic</title><script>ignore()</script></head>
          <body>
            <nav>Menu</nav>
            <main>
              <h1>Finding</h1>
              <p>Useful <a href="/source">evidence</a>.</p>
              <a href="javascript:alert(1)">unsafe</a>
            </main>
          </body>
        </html>
      `)
    })

    const result = await fetchWebPage({
      url: 'https://example.com/articles/topic#section',
      maxChars: 1000
    }, undefined, transport)

    expect(transport).toHaveBeenCalledWith(
      'https://example.com/articles/topic',
      expect.any(AbortSignal),
      expect.objectContaining({ Accept: expect.stringContaining('text/html') })
    )
    expect(result).toMatchObject({
      requestedUrl: 'https://example.com/articles/topic',
      url: 'https://example.com/articles/topic',
      status: 200,
      contentType: 'text/html',
      title: 'Example Topic',
      truncated: false
    })
    expect(result.content).toContain('# Finding')
    expect(result.content).toContain('[evidence](https://example.com/source)')
    expect(result.content).not.toContain('ignore()')
    expect(result.content).not.toContain('javascript:')
    expect(result.content).not.toContain('Menu')
  })

  it('truncates text output to the requested character budget', async () => {
    const transport = vi.fn<WebFetchTransport>().mockResolvedValue({
      status: 200,
      ok: true,
      url: 'https://example.com/data.txt',
      headers: new Headers({ 'Content-Type': 'text/plain' }),
      body: stream('x'.repeat(1500))
    })

    const result = await fetchWebPage({
      url: 'https://example.com/data.txt',
      maxChars: 1000
    }, undefined, transport)

    expect(result.content).toHaveLength(1000)
    expect(result.truncated).toBe(true)
  })

  it('rejects credential URLs, binary content, and oversized responses', async () => {
    const transport = vi.fn<WebFetchTransport>()
    await expect(fetchWebPage({
      url: 'https://user:secret@example.com'
    }, undefined, transport)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(transport).not.toHaveBeenCalled()

    const cancel = vi.fn().mockResolvedValue(undefined)
    transport.mockResolvedValueOnce({
      status: 200,
      ok: true,
      url: 'https://example.com/file.pdf',
      headers: new Headers({ 'Content-Type': 'application/pdf' }),
      body: { cancel } as unknown as ReadableStream<Uint8Array>
    })
    await expect(fetchWebPage({
      url: 'https://example.com/file.pdf'
    }, undefined, transport)).rejects.toMatchObject({ code: 'unsupported_content_type' })
    expect(cancel).toHaveBeenCalled()

    const oversizedCancel = vi.fn().mockResolvedValue(undefined)
    transport.mockResolvedValueOnce({
      status: 200,
      ok: true,
      url: 'https://example.com/large',
      headers: new Headers({
        'Content-Type': 'text/plain',
        'Content-Length': String(2 * 1024 * 1024 + 1)
      }),
      body: { cancel: oversizedCancel } as unknown as ReadableStream<Uint8Array>
    })
    await expect(fetchWebPage({
      url: 'https://example.com/large'
    }, undefined, transport)).rejects.toMatchObject({ code: 'response_too_large' })
    expect(oversizedCancel).toHaveBeenCalledOnce()
  })
})
