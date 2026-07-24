import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''))
  }
}))

import { createRepositories } from '../../src/main/db/repositories'
import { createWebSearchService } from '../../src/main/services/webSearch'
import {
  createMainTestDb,
  migrateMainTestDb,
  type MainTestDb
} from '../helpers/mainDb'

describe('web search service', () => {
  let db: MainTestDb
  let repos: ReturnType<typeof createRepositories>
  const ddgsRuntime = {
    getStatus: vi.fn().mockResolvedValue({ installed: false, version: '9.14.4' }),
    search: vi.fn()
  }
  const fetchMock = vi.fn()
  const fetchPageMock = vi.fn()

  beforeEach(() => {
    db = createMainTestDb()
    repos = createRepositories(migrateMainTestDb(db))
    ddgsRuntime.getStatus.mockReset().mockResolvedValue({ installed: false, version: '9.14.4' })
    ddgsRuntime.search.mockReset()
    fetchMock.mockReset()
    fetchPageMock.mockReset()
  })

  it('starts with keyless DDGS enabled and never exposes encrypted API keys', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })

    await expect(service.getConfig()).resolves.toEqual({
      provider: 'ddgs',
      hasTavilyApiKey: false,
      hasBraveApiKey: false,
      ddgsInstalled: false,
      ddgsVersion: '9.14.4'
    })
    expect(service.isEnabled()).toBe(true)
  })

  it('disables both search and page fetch when web access is turned off', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock,
      fetchPage: fetchPageMock
    })
    await service.updateConfig({ provider: 'disabled' })

    await expect(service.search({ query: 'test' })).rejects.toMatchObject({
      code: 'web_search_disabled'
    })
    await expect(service.fetchPage({ url: 'https://example.com' })).rejects.toMatchObject({
      code: 'web_search_disabled'
    })
    expect(fetchPageMock).not.toHaveBeenCalled()
  })

  it('encrypts Tavily and Brave keys and requires a key for keyed providers', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })

    await expect(service.updateConfig({ provider: 'tavily' })).rejects.toMatchObject({
      code: 'no_api_key'
    })
    const config = await service.updateConfig({
      provider: 'tavily',
      tavilyApiKey: 'tvly-secret',
      braveApiKey: 'brave-secret'
    })

    expect(config).toMatchObject({
      provider: 'tavily',
      hasTavilyApiKey: true,
      hasBraveApiKey: true
    })
    const row = repos.webSearchConfig.get()
    expect(row.tavilyApiKeyEnc?.toString()).toBe('encrypted:tvly-secret')
    expect(row.braveApiKeyEnc?.toString()).toBe('encrypted:brave-secret')
  })

  it('calls Tavily with bounded options and filters unsafe or disallowed results', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })
    await service.updateConfig({ provider: 'tavily', tavilyApiKey: 'tvly-secret' })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      results: [
        {
          title: 'Allowed',
          url: 'https://docs.example.com/article',
          content: 'Useful source',
          published_date: '2026-07-24'
        },
        { title: 'Other', url: 'https://other.test', content: 'Excluded' },
        { title: 'Unsafe', url: 'file:///tmp/secret', content: 'Excluded' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const result = await service.search({
      query: 'new research',
      maxResults: 4,
      timeRange: 'week',
      allowedDomains: ['example.com']
    })

    expect(result).toEqual({
      provider: 'tavily',
      query: 'new research',
      results: [{
        title: 'Allowed',
        url: 'https://docs.example.com/article',
        snippet: 'Useful source',
        publishedAt: '2026-07-24'
      }]
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init.headers.Authorization).toBe('Bearer tvly-secret')
    expect(JSON.parse(init.body)).toMatchObject({
      query: 'new research',
      search_depth: 'basic',
      max_results: 4,
      include_answer: false,
      include_raw_content: false,
      time_range: 'week',
      include_domains: ['example.com']
    })
  })

  it('calls Brave with the subscription header, version, locale, and freshness', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })
    await service.updateConfig({ provider: 'brave', braveApiKey: 'brave-secret' })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      web: {
        results: [{
          title: 'Brave result',
          url: 'https://example.com/result',
          description: 'Snippet'
        }]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await service.search({
      query: 'agent tools',
      maxResults: 3,
      timeRange: 'day',
      region: 'zh-cn'
    })

    const [rawUrl, init] = fetchMock.mock.calls[0]
    const url = new URL(rawUrl)
    expect(url.origin + url.pathname).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(url.searchParams.get('q')).toBe('agent tools')
    expect(url.searchParams.get('count')).toBe('3')
    expect(url.searchParams.get('freshness')).toBe('pd')
    expect(url.searchParams.get('country')).toBe('CN')
    expect(url.searchParams.get('search_lang')).toBe('zh')
    expect(init.headers['X-Subscription-Token']).toBe('brave-secret')
    expect(init.headers['Api-Version']).toBe('2023-01-01')
  })

  it('uses only the managed DDGS runner and forwards the configured proxy', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })
    repos.settings.set('proxyUrl', 'http://127.0.0.1:8080')
    await service.updateConfig({ provider: 'ddgs' })
    ddgsRuntime.search.mockResolvedValue([
      { title: 'DDGS result', url: 'https://example.com/ddgs', snippet: 'Snippet' }
    ])

    const result = await service.search({
      query: 'keyless search',
      maxResults: 2,
      allowedDomains: ['example.com']
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ddgsRuntime.search).toHaveBeenCalledWith(expect.objectContaining({
      query: 'keyless search (site:example.com)',
      maxResults: 2,
      proxy: 'http://127.0.0.1:8080'
    }), expect.any(AbortSignal))
    expect(result.results).toHaveLength(1)
  })

  it('does not apply the network request timeout to DDGS runtime installation', async () => {
    const timedOut = new AbortController()
    timedOut.abort()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timedOut.signal)
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })
    ddgsRuntime.search.mockImplementation(async (_request, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false)
      return []
    })

    await expect(service.search({ query: 'first install' })).resolves.toEqual({
      provider: 'ddgs',
      query: 'first install',
      results: []
    })
    expect(timeout).not.toHaveBeenCalled()
    timeout.mockRestore()
  })

  it('reports provider authentication and rate-limit errors without exposing keys', async () => {
    const service = createWebSearchService({
      repos,
      ddgsRuntime: ddgsRuntime as never,
      fetch: fetchMock
    })
    await service.updateConfig({ provider: 'tavily', tavilyApiKey: 'tvly-secret' })
    fetchMock.mockResolvedValue(new Response('quota', { status: 429 }))

    await expect(service.search({ query: 'test' })).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Tavily rate limit exceeded'
    })
  })
})
