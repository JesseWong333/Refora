import { safeStorage } from 'electron'
import type { Repositories } from '../db/repositories'
import { RepoError } from '../db/repositories/errors'
import type {
  WebFetchRequest,
  WebFetchResponse,
  WebSearchConfig,
  WebSearchConfigPatch,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchResultItem,
  WebSearchTestResult
} from '../../shared/webSearch'
import { WEB_SEARCH_PROVIDERS } from '../../shared/webSearch'
import { DDGS_VERSION, type DdgsRuntimeManager } from './ddgsRuntime'
import { fetchWebPage } from './webFetch'

const SEARCH_TIMEOUT_MS = 15_000
const MAX_QUERY_LENGTH = 400
const MAX_RESULTS = 10
const MAX_DOMAINS = 10
const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

interface WebSearchServiceDeps {
  repos: Repositories
  ddgsRuntime: DdgsRuntimeManager
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  fetchPage?: typeof fetchWebPage
}

interface TavilyResponse {
  results?: Array<{
    title?: unknown
    url?: unknown
    content?: unknown
    published_date?: unknown
  }>
}

interface BraveResponse {
  web?: {
    results?: Array<{
      title?: unknown
      url?: unknown
      description?: unknown
      age?: unknown
      page_age?: unknown
    }>
  }
}

function encryptKey(value: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new RepoError(
      'encryption_unavailable',
      'OS keychain (safeStorage) is not available. Search API keys cannot be securely stored.'
    )
  }
  return safeStorage.encryptString(value)
}

function decryptKey(value: Buffer | null, provider: 'tavily' | 'brave'): string {
  if (!value) throw new RepoError('no_api_key', `${provider === 'tavily' ? 'Tavily' : 'Brave'} API key is not configured`)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new RepoError(
      'encryption_unavailable',
      'OS keychain (safeStorage) is not available. Search API keys cannot be decrypted.'
    )
  }
  return safeStorage.decryptString(value)
}

function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function normalizeProvider(value: unknown): WebSearchProvider {
  if (typeof value === 'string' && WEB_SEARCH_PROVIDERS.includes(value as WebSearchProvider)) {
    return value as WebSearchProvider
  }
  throw new RepoError('invalid_input', 'Unknown web search provider')
}

function normalizeDomains(values: string[] | undefined): string[] {
  const result: string[] = []
  for (const value of values ?? []) {
    const domain = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '')
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domain)) {
      throw new RepoError('invalid_input', `Invalid allowed domain: ${value}`)
    }
    if (!result.includes(domain)) result.push(domain)
    if (result.length > MAX_DOMAINS) {
      throw new RepoError('invalid_input', `A maximum of ${MAX_DOMAINS} domains is allowed`)
    }
  }
  return result
}

function hostnameAllowed(hostname: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  const normalized = hostname.toLowerCase()
  return allowedDomains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
}

function normalizeItems(items: WebSearchResultItem[], allowedDomains: string[]): WebSearchResultItem[] {
  const seen = new Set<string>()
  const result: WebSearchResultItem[] = []
  for (const item of items) {
    let url: URL
    try {
      url = new URL(text(item.url, 2048))
    } catch {
      continue
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !hostnameAllowed(url.hostname, allowedDomains) ||
      seen.has(url.toString())
    ) {
      continue
    }
    seen.add(url.toString())
    result.push({
      title: text(item.title, 300),
      url: url.toString(),
      snippet: text(item.snippet, 2000),
      ...(item.publishedAt ? { publishedAt: text(item.publishedAt, 100) } : {})
    })
    if (result.length >= MAX_RESULTS) break
  }
  return result
}

function effectiveQuery(query: string, allowedDomains: string[]): string {
  if (allowedDomains.length === 0) return query
  const sites = allowedDomains.map((domain) => `site:${domain}`)
  return `${query} (${sites.join(' OR ')})`.slice(0, MAX_QUERY_LENGTH)
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function responseError(response: Response, provider: string): Promise<never> {
  const detail = text(await response.text().catch(() => ''), 500)
  const suffix = detail ? `: ${detail}` : ''
  if (response.status === 401 || response.status === 403) {
    throw new RepoError('invalid_api_key', `${provider} rejected the API key`)
  }
  if (response.status === 429) {
    throw new RepoError('rate_limited', `${provider} rate limit exceeded`)
  }
  throw new RepoError('search_failed', `${provider} search failed with HTTP ${response.status}${suffix}`)
}

export function createWebSearchService(deps: WebSearchServiceDeps) {
  const lifecycleController = new AbortController()

  async function getConfig(): Promise<WebSearchConfig> {
    const row = deps.repos.webSearchConfig.get()
    const ddgs = await deps.ddgsRuntime.getStatus()
    return {
      provider: row.provider,
      hasTavilyApiKey: row.tavilyApiKeyEnc != null,
      hasBraveApiKey: row.braveApiKeyEnc != null,
      ddgsInstalled: ddgs.installed,
      ddgsVersion: DDGS_VERSION
    }
  }

  async function updateConfig(patch: WebSearchConfigPatch): Promise<WebSearchConfig> {
    if (patch.clearTavilyApiKey && patch.tavilyApiKey?.trim()) {
      throw new RepoError('invalid_input', 'Tavily API key cannot be set and cleared together')
    }
    if (patch.clearBraveApiKey && patch.braveApiKey?.trim()) {
      throw new RepoError('invalid_input', 'Brave API key cannot be set and cleared together')
    }
    const current = deps.repos.webSearchConfig.get()
    const provider = patch.provider === undefined ? current.provider : normalizeProvider(patch.provider)
    const tavilyApiKey = patch.tavilyApiKey?.trim()
    const braveApiKey = patch.braveApiKey?.trim()
    const tavilyApiKeyEnc = patch.clearTavilyApiKey
      ? null
      : tavilyApiKey
        ? encryptKey(tavilyApiKey)
        : undefined
    const braveApiKeyEnc = patch.clearBraveApiKey
      ? null
      : braveApiKey
        ? encryptKey(braveApiKey)
        : undefined
    const hasTavilyKey = tavilyApiKeyEnc !== undefined
      ? tavilyApiKeyEnc != null
      : current.tavilyApiKeyEnc != null
    const hasBraveKey = braveApiKeyEnc !== undefined
      ? braveApiKeyEnc != null
      : current.braveApiKeyEnc != null
    if (provider === 'tavily' && !hasTavilyKey) {
      throw new RepoError('no_api_key', 'Configure a Tavily API key before selecting Tavily')
    }
    if (provider === 'brave' && !hasBraveKey) {
      throw new RepoError('no_api_key', 'Configure a Brave API key before selecting Brave')
    }
    deps.repos.webSearchConfig.update({
      provider,
      tavilyApiKeyEnc,
      braveApiKeyEnc
    })
    return getConfig()
  }

  function isEnabled(): boolean {
    return deps.repos.webSearchConfig.get().provider !== 'disabled'
  }

  async function searchTavily(
    apiKey: string,
    query: string,
    maxResults: number,
    timeRange: WebSearchRequest['timeRange'],
    allowedDomains: string[],
    signal?: AbortSignal
  ): Promise<WebSearchResultItem[]> {
    const response = await deps.fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      signal: requestSignal(signal),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        ...(timeRange ? { time_range: timeRange } : {}),
        ...(allowedDomains.length > 0 ? { include_domains: allowedDomains } : {})
      })
    })
    if (!response.ok) return responseError(response, 'Tavily')
    const body = await response.json() as TavilyResponse
    return (body.results ?? []).map((item) => ({
      title: text(item.title, 300),
      url: text(item.url, 2048),
      snippet: text(item.content, 2000),
      ...(typeof item.published_date === 'string'
        ? { publishedAt: text(item.published_date, 100) }
        : {})
    }))
  }

  async function searchBrave(
    apiKey: string,
    query: string,
    maxResults: number,
    timeRange: WebSearchRequest['timeRange'],
    allowedDomains: string[],
    region: string | undefined,
    signal?: AbortSignal
  ): Promise<WebSearchResultItem[]> {
    const url = new URL(BRAVE_ENDPOINT)
    url.searchParams.set('q', effectiveQuery(query, allowedDomains))
    url.searchParams.set('count', String(maxResults))
    url.searchParams.set('safesearch', 'moderate')
    if (timeRange) {
      url.searchParams.set('freshness', {
        day: 'pd',
        week: 'pw',
        month: 'pm',
        year: 'py'
      }[timeRange])
    }
    if (region && /^[a-z]{2}-[a-z]{2}$/i.test(region)) {
      const [language, country] = region.split('-')
      url.searchParams.set('country', country.toUpperCase())
      url.searchParams.set('search_lang', language.toLowerCase())
      url.searchParams.set('ui_lang', `${language.toLowerCase()}-${country.toUpperCase()}`)
    }
    const response = await deps.fetch(url.toString(), {
      signal: requestSignal(signal),
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
        'Api-Version': '2023-01-01'
      }
    })
    if (!response.ok) return responseError(response, 'Brave')
    const body = await response.json() as BraveResponse
    return (body.web?.results ?? []).map((item) => ({
      title: text(item.title, 300),
      url: text(item.url, 2048),
      snippet: text(item.description, 2000),
      ...((typeof item.page_age === 'string' || typeof item.age === 'string')
        ? { publishedAt: text(item.page_age ?? item.age, 100) }
        : {})
    }))
  }

  async function search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResponse> {
    const query = request.query.trim()
    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new RepoError('invalid_input', `Search query must be between 1 and ${MAX_QUERY_LENGTH} characters`)
    }
    const maxResults = Math.max(1, Math.min(MAX_RESULTS, Math.floor(request.maxResults ?? 8)))
    const allowedDomains = normalizeDomains(request.allowedDomains)
    const activeSignal = signal
      ? AbortSignal.any([signal, lifecycleController.signal])
      : lifecycleController.signal
    const row = deps.repos.webSearchConfig.get()
    if (row.provider === 'disabled') {
      throw new RepoError('web_search_disabled', 'Web search is disabled in Settings')
    }
    let items: WebSearchResultItem[]
    if (row.provider === 'ddgs') {
      items = await deps.ddgsRuntime.search({
        query: effectiveQuery(query, allowedDomains),
        maxResults,
        timeRange: request.timeRange,
        region: request.region,
        proxy: deps.repos.settings.get<string>('proxyUrl', '').trim() || undefined
      }, activeSignal)
    } else if (row.provider === 'tavily') {
      items = await searchTavily(
        decryptKey(row.tavilyApiKeyEnc, 'tavily'),
        query,
        maxResults,
        request.timeRange,
        allowedDomains,
        activeSignal
      )
    } else {
      items = await searchBrave(
        decryptKey(row.braveApiKeyEnc, 'brave'),
        query,
        maxResults,
        request.timeRange,
        allowedDomains,
        request.region,
        activeSignal
      )
    }
    return {
      provider: row.provider,
      query,
      results: normalizeItems(items, allowedDomains).slice(0, maxResults)
    }
  }

  async function fetchPage(
    request: WebFetchRequest,
    signal?: AbortSignal
  ): Promise<WebFetchResponse> {
    if (!isEnabled()) {
      throw new RepoError('web_search_disabled', 'Web access is disabled in Settings')
    }
    const activeSignal = signal
      ? AbortSignal.any([signal, lifecycleController.signal])
      : lifecycleController.signal
    return (deps.fetchPage ?? fetchWebPage)(request, activeSignal)
  }

  async function test(): Promise<WebSearchTestResult> {
    const provider = deps.repos.webSearchConfig.get().provider
    if (provider === 'disabled') {
      return { ok: false, provider, resultCount: 0, error: 'Web search is disabled' }
    }
    try {
      const response = await search({ query: 'Refora literature manager', maxResults: 1 })
      return {
        ok: response.results.length > 0,
        provider,
        resultCount: response.results.length,
        ...(response.results.length === 0 ? { error: 'The provider returned no results' } : {})
      }
    } catch (error) {
      return {
        ok: false,
        provider,
        resultCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  function destroy(): void {
    lifecycleController.abort()
  }

  return { getConfig, updateConfig, isEnabled, search, fetchPage, test, destroy }
}

export type WebSearchService = ReturnType<typeof createWebSearchService>
