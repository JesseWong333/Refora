import { DOMParser } from 'linkedom'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import type { ArxivPaperSection } from '../../shared/academicResearch'

export interface ArxivMarkdownDocument {
  title?: string
  markdown: string
  sections: ArxivPaperSection[]
  warnings: string[]
}

interface RemovableElement {
  remove(): void
}

interface AttributedElement {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
}

interface MathElement {
  querySelector(selector: string): { textContent: string | null } | null
  getAttribute(name: string): string | null
  closest(selector: string): unknown
  replaceWith(node: unknown): void
}

function absoluteUrl(value: string, sourceUrl: string): string {
  try {
    return new URL(value, sourceUrl).toString()
  } catch {
    return value
  }
}

function buildSections(markdown: string): ArxivPaperSection[] {
  const matches = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)]
  return matches.map((match, index) => {
    const start = match.index ?? 0
    return {
      id: `section-${index + 1}`,
      title: match[2].trim(),
      level: match[1].length,
      start,
      end: matches[index + 1]?.index ?? markdown.length
    }
  })
}

export function convertArxivHtmlToMarkdown(
  html: string,
  sourceUrl: string
): ArxivMarkdownDocument {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const root =
    document.querySelector('article.ltx_document') ??
    document.querySelector('article') ??
    document.querySelector('main') ??
    document.body
  const warnings: string[] = []

  root.querySelectorAll(
    'script, style, nav, form, button, input, textarea, select, noscript, iframe, object, embed, .ltx_page_navbar'
  ).forEach((element: RemovableElement) => element.remove())

  root.querySelectorAll('[href]').forEach((element: AttributedElement) => {
    const href = element.getAttribute('href')
    if (href) element.setAttribute('href', absoluteUrl(href, sourceUrl))
  })
  root.querySelectorAll('[src]').forEach((element: AttributedElement) => {
    const src = element.getAttribute('src')
    if (src) element.setAttribute('src', absoluteUrl(src, sourceUrl))
  })

  const mathTokens = new Map<string, string>()
  let mathIndex = 0
  root.querySelectorAll('math').forEach((math: MathElement) => {
    const annotation = math.querySelector(
      'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"]'
    )?.textContent?.trim()
    const tex = annotation || math.getAttribute('alttext')?.trim()
    if (!tex) {
      warnings.push('A formula could not be converted to TeX.')
      return
    }
    const display =
      math.getAttribute('display') === 'block' ||
      math.closest('.ltx_equation, .ltx_equationgroup') !== null
    const token = `REFORAMATHTOKEN${mathIndex}END`
    mathIndex += 1
    mathTokens.set(token, display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`)
    math.replaceWith(document.createTextNode(token))
  })

  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**'
  })
  turndown.use(gfm)
  turndown.addRule('removeSvg', {
    filter: (node) => node.nodeName === 'SVG',
    replacement: () => ''
  })
  turndown.addRule('figure', {
    filter: 'figure',
    replacement(content) {
      return `\n\n${content.trim()}\n\n`
    }
  })

  let markdown = turndown.turndown(root)
  for (const [token, replacement] of mathTokens) {
    markdown = markdown.split(token).join(replacement)
  }
  markdown = markdown
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()

  const title =
    document.querySelector('meta[name="citation_title"]')?.getAttribute('content')?.trim() ||
    document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() ||
    undefined

  return {
    title,
    markdown,
    sections: buildSections(markdown),
    warnings: [...new Set(warnings)]
  }
}
