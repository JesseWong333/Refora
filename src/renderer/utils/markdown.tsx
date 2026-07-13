import { useState, useRef, type ComponentPropsWithoutRef } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import type { Components } from 'react-markdown'
import { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export const REMARK_PLUGINS = [remarkGfm, remarkMath]
export const REHYPE_PLUGINS = [rehypeKatex]

export function urlTransform(url: string): string {
  if (url.startsWith('refora://')) return url
  return defaultUrlTransform(url)
}

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  return (
    <div className="group/code relative">
      <button
        type="button"
        className="absolute right-1 top-1 z-10 rounded p-1 text-muted opacity-0 transition-opacity hover:text-foreground group-hover/code:opacity-100"
        onClick={() => {
          const text =
            ref.current?.querySelector('code')?.textContent ??
            ref.current?.textContent ??
            ''
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
        aria-label="Copy code"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  )
}

const BASE_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: CodeBlock
}

export const MARKDOWN_COMPONENTS: Components = BASE_MARKDOWN_COMPONENTS

export function createMarkdownComponents(
  overrides?: Partial<Components>
): Components {
  return { ...BASE_MARKDOWN_COMPONENTS, ...overrides }
}
