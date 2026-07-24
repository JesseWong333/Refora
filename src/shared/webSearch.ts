export const WEB_SEARCH_PROVIDERS = ['disabled', 'ddgs', 'tavily', 'brave'] as const

export type WebSearchProvider = typeof WEB_SEARCH_PROVIDERS[number]
export type WebSearchTimeRange = 'day' | 'week' | 'month' | 'year'

export interface WebSearchConfig {
  provider: WebSearchProvider
  hasTavilyApiKey: boolean
  hasBraveApiKey: boolean
  ddgsInstalled: boolean
  ddgsVersion: string
}

export interface WebSearchConfigPatch {
  provider?: WebSearchProvider
  tavilyApiKey?: string
  braveApiKey?: string
  clearTavilyApiKey?: boolean
  clearBraveApiKey?: boolean
}

export interface WebSearchTestResult {
  ok: boolean
  provider: WebSearchProvider
  resultCount: number
  error?: string
}

export interface WebSearchRequest {
  query: string
  maxResults?: number
  timeRange?: WebSearchTimeRange
  allowedDomains?: string[]
  region?: string
}

export interface WebSearchResultItem {
  title: string
  url: string
  snippet: string
  publishedAt?: string
}

export interface WebSearchResponse {
  provider: Exclude<WebSearchProvider, 'disabled'>
  query: string
  results: WebSearchResultItem[]
}

export interface WebFetchRequest {
  url: string
  maxChars?: number
}

export interface WebFetchResponse {
  requestedUrl: string
  url: string
  status: number
  contentType: string
  title?: string
  content: string
  truncated: boolean
}
