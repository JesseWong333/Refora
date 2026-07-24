import { Buffer } from 'node:buffer'
import { DOMParser } from 'linkedom'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type {
  WebFetchRequest,
  WebFetchResponse
} from '../../shared/webSearch'
import { RepoError } from '../db/repositories/errors'
import { fetchPublicUrl } from './identifierImport'

const FETCH_TIMEOUT_MS = 20_000
const MAX_URL_LENGTH = 2048
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_CHARS = 20_000
const MAX_CONTENT_CHARS = 40_000

interface RemovableElement {
  remove(): void
}

interface AttributedElement {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

interface PublicFetchResponse {
  status: number
  ok: boolean
  url: string
  headers: Headers
  body: ReadableStream<Uint8Array> | null
}

export type WebFetchTransport = (
  url: string,
  signal: AbortSignal,
  headers: Record<string, string>
) => Promise<PublicFetchResponse>

function activeSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) {
    throw new RepoError('invalid_input', `URL must be between 1 and ${MAX_URL_LENGTH} characters`)
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new RepoError('invalid_input', 'URL is invalid')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RepoError('invalid_input', 'Only HTTP(S) URLs can be fetched')
  }
  if (parsed.username || parsed.password) {
    throw new RepoError('invalid_input', 'URLs containing credentials cannot be fetched')
  }
  parsed.hash = ''
  return parsed.toString()
}

function parseContentType(value: string | null): { mime: string; charset: string } {
  const parts = (value ?? '').split(';').map((part) => part.trim())
  const mime = parts[0]?.toLowerCase() ?? ''
  const charsetPart = parts.find((part) => part.toLowerCase().startsWith('charset='))
  const charset = charsetPart?.slice(charsetPart.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || 'utf-8'
  return { mime, charset }
}

function isSupportedContentType(mime: string): boolean {
  return mime === '' ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/ld+json' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/xml'
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null
): Promise<Uint8Array> {
  const declaredLength = Number(contentLength)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    await body?.cancel().catch(() => undefined)
    throw new RepoError('response_too_large', 'Web page exceeds the 2 MB download limit')
  }
  if (!body) return new Uint8Array()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new RepoError('response_too_large', 'Web page exceeds the 2 MB download limit')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

function decode(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function safeAbsoluteUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function htmlToMarkdown(html: string, sourceUrl: string): { title?: string; content: string } {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document.querySelectorAll(
    'script, style, nav, aside, footer, form, button, input, textarea, select, option, noscript, iframe, object, embed, canvas, video, audio, picture, source'
  ).forEach((element: RemovableElement) => element.remove())
  document.querySelectorAll('img, svg').forEach((element: RemovableElement) => element.remove())
  document.querySelectorAll('a[href]').forEach((element: AttributedElement) => {
    const href = element.getAttribute('href')
    const absolute = href ? safeAbsoluteUrl(href, sourceUrl) : null
    if (absolute) element.setAttribute('href', absolute)
    else element.removeAttribute('href')
  })
  const root =
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.body
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**'
  })
  turndown.use(gfm)
  const content = turndown.turndown(root)
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
  const title = document.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300)
  return {
    ...(title ? { title } : {}),
    content
  }
}

export async function fetchWebPage(
  request: WebFetchRequest,
  signal?: AbortSignal,
  transport: WebFetchTransport = fetchPublicUrl
): Promise<WebFetchResponse> {
  const requestedUrl = normalizeUrl(request.url)
  const maxChars = Math.max(
    1000,
    Math.min(MAX_CONTENT_CHARS, Math.floor(request.maxChars ?? DEFAULT_MAX_CHARS))
  )
  let response: PublicFetchResponse
  try {
    response = await transport(requestedUrl, activeSignal(signal), {
      Accept: 'text/html, text/plain, text/markdown, application/xhtml+xml, application/json;q=0.9, */*;q=0.1',
      'Accept-Encoding': 'identity',
      'User-Agent': 'Refora/0.1 web_fetch'
    })
  } catch (error) {
    throw new RepoError(
      'web_fetch_failed',
      error instanceof Error ? error.message : String(error)
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new RepoError('web_fetch_failed', `Web fetch failed with HTTP ${response.status}`)
  }
  const { mime, charset } = parseContentType(response.headers.get('content-type'))
  if (!isSupportedContentType(mime)) {
    await response.body?.cancel()
    throw new RepoError(
      'unsupported_content_type',
      `Web fetch supports text and HTML responses, not ${mime || 'this content type'}`
    )
  }
  const bytes = await readBoundedBody(
    response.body,
    response.headers.get('content-length')
  )
  const raw = decode(bytes, charset)
  const looksLikeHtml = mime.includes('html') || (!mime && /<(?:!doctype|html|head|body)\b/i.test(raw))
  const converted = looksLikeHtml
    ? htmlToMarkdown(raw, response.url)
    : { content: raw.replace(/\r\n?/g, '\n').trim() }
  const truncated = converted.content.length > maxChars
  return {
    requestedUrl,
    url: response.url,
    status: response.status,
    contentType: mime || (looksLikeHtml ? 'text/html' : 'text/plain'),
    ...(converted.title ? { title: converted.title } : {}),
    content: converted.content.slice(0, maxChars),
    truncated
  }
}
