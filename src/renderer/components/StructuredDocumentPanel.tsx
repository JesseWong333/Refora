import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { FileText } from '@phosphor-icons/react'
import { api } from '../ipc'
import { useOcrReaderStore } from '../store/ocrReaderStore'
import {
  createMarkdownComponents,
  REHYPE_PLUGINS,
  REMARK_PLUGINS,
  urlTransform
} from '../utils/markdown'
import { EmptyState, PanelHeader } from './ui'

export default function StructuredDocumentPanel() {
  const { t } = useTranslation()
  const documentId = useOcrReaderStore((state) => state.documentId)
  const resultKey = useOcrReaderStore((state) => state.resultKey)
  const title = useOcrReaderStore((state) => state.title)
  const close = useOcrReaderStore((state) => state.close)
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setMarkdown('')
    setLoading(true)
    setFailed(false)
    if (!documentId || !resultKey) {
      setLoading(false)
      return
    }
    void api.ocr.readMarkdown(documentId, resultKey).then((content) => {
      if (!active) return
      setMarkdown(content)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setFailed(true)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [documentId, resultKey])

  const components = useMemo(() => createMarkdownComponents({
    img: ({ src, alt, ...props }) => {
      const assetPath = src?.startsWith('images/')
        ? `assets/${src.slice('images/'.length)}`
        : src?.startsWith('assets/') ? src : null
      const resolved = documentId && resultKey && assetPath
        ? api.ocr.assetUrl(documentId, resultKey, assetPath)
        : src
      return <img {...props} src={resolved} alt={alt ?? ''} loading="lazy" />
    }
  }), [documentId, resultKey])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <PanelHeader
        title={title || t('ocr.title')}
        onClose={close}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title={t('ocr.readerLoading')}
          />
        ) : failed ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title={t('ocr.readerFailed')}
          />
        ) : (
          <article className="markdown-body mx-auto w-full max-w-5xl select-text px-6 py-10 text-sm text-foreground sm:px-12 [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_h1]:mt-0 [&_h1]:text-2xl [&_h2]:mt-8 [&_h3]:mt-6 [&_img]:mx-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-panel-2 [&_pre]:p-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_ul]:list-disc [&_ul]:pl-5">
            {markdown ? (
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={components}
                urlTransform={urlTransform}
              >
                {markdown}
              </ReactMarkdown>
            ) : (
              <p className="italic text-muted">{t('ocr.empty')}</p>
            )}
          </article>
        )}
      </div>
    </div>
  )
}
