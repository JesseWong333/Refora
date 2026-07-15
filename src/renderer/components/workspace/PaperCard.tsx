import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { Sparkle, FileText, Trash, CircleNotch, BookOpen, WarningCircle, ArrowClockwise } from '@phosphor-icons/react'
import { motion, MotionConfig } from 'motion/react'
import { Button, Badge, cardClassName } from '../ui'
import type { AiSummary, Document } from '../../../shared/ipc-types'

interface PaperCardProps {
  doc: Document | null
  summary: AiSummary | null
  summarizing: boolean
  summaryError: string | null
  onSummarize: () => void
  onOpenPdf: () => void
  onRemove: () => void
}

export default function PaperCard({
  doc,
  summary,
  summarizing,
  summaryError,
  onSummarize,
  onOpenPdf,
  onRemove
}: PaperCardProps) {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState(false)

  const title = doc?.title || doc?.fileName || '…'
  const authors = doc?.authors
  const content = summary?.content ?? null
  const keyPoints = content?.keyPoints ?? []
  const previewKeyPoints = keyPoints.slice(0, 3)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const menuItems: ContextMenuItem[] = [
      {
        key: 'summarize',
        label: t('workspace.aiSummary'),
        icon: <Sparkle className="h-3.5 w-3.5" />,
        onClick: onSummarize
      },
      {
        key: 'openPdf',
        label: t('workspace.openPdf'),
        icon: <FileText className="h-3.5 w-3.5" />,
        onClick: onOpenPdf
      },
      { type: 'divider', key: 'divider' },
      {
        key: 'remove',
        label: t('workspace.removeFromWorkspace'),
        icon: <Trash className="h-3.5 w-3.5" />,
        onClick: onRemove,
        danger: true
      }
    ]
    showContextMenu(menuItems)
  }

  return (
    <>
      <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        data-card-kind="document"
        className={cardClassName('default', false, 'workspace-content-card workspace-content-card--document group/card flex h-full w-full cursor-pointer flex-col gap-2 overflow-hidden p-3')}
        onClick={() => setModalOpen(true)}
        onContextMenu={handleContextMenu}
      >
        <div className="flex shrink-0 items-start gap-2">
          <span className="workspace-card-type-icon">
            <BookOpen className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="workspace-card-type-label">{t('workspace.cardTypePaper')}</span>
            <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{title}</h3>
            {authors && <p className="mt-0.5 truncate text-xs text-muted">{authors}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/card:opacity-100">
            {!content && !summarizing && !summaryError && (
              <button
                type="button"
                className="rounded p-1 text-muted transition-colors duration-150 hover:text-accent"
                onClick={(e) => { e.stopPropagation(); onSummarize() }}
                title={t('workspace.aiSummary')}
                aria-label={t('workspace.aiSummary')}
              >
                <Sparkle className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              className="rounded p-1 text-muted transition-colors duration-150 hover:text-accent"
              onClick={(e) => { e.stopPropagation(); onOpenPdf() }}
              title={t('workspace.openPdf')}
              aria-label={t('workspace.openPdf')}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted transition-colors duration-150 hover:text-error"
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              title={t('workspace.removeFromWorkspace')}
              aria-label={t('workspace.removeFromWorkspace')}
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {(doc?.year || doc?.venue) && (
          <div className="flex shrink-0 flex-wrap gap-1">
            {doc?.year && <Badge variant="default" size="md">{doc.year}</Badge>}
            {doc?.venue && <Badge variant="default" size="md">{doc.venue}</Badge>}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden text-xs">
          {summarizing ? (
            <div className="flex items-center gap-1.5 text-muted">
              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
              <span>{t('workspace.summarizing')}</span>
            </div>
          ) : summaryError ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-1.5 rounded-lg bg-error/10 px-2 py-1.5 text-error">
                <WarningCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="line-clamp-3">{summaryError}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSummarize()
                }}
                className="inline-flex items-center gap-1 text-muted transition-colors duration-150 hover:text-foreground"
              >
                <ArrowClockwise className="h-3 w-3" />
                {t('workspace.retry')}
              </button>
            </div>
          ) : content ? (
            <div className="h-full space-y-1.5 overflow-hidden">
              <p className="line-clamp-6 text-foreground">{content.core}</p>
              {previewKeyPoints.length > 0 && (
                <ul className="space-y-0.5">
                  {previewKeyPoints.map((kp, i) => (
                    <li key={i} className="flex gap-1">
                      <span className="shrink-0 text-accent">•</span>
                      <span className="line-clamp-2 text-muted">{kp}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="italic text-muted">{t('workspace.summarizeHint')}</p>
          )}
        </div>
      </motion.div>
      </MotionConfig>

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        title={title}
        footer={null}
        width={640}
      >
        {content ? (
          <div className="space-y-4">
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {t('workspace.summaryCore')}
              </h4>
              <p className="text-sm text-foreground">{content.core}</p>
            </section>
            {keyPoints.length > 0 && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.summaryKeyPoints')}
                </h4>
                <ul className="space-y-1 text-sm text-foreground">
                  {keyPoints.map((kp, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 text-accent">•</span>
                      <span>{kp}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {content.methods && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.summaryMethods')}
                </h4>
                <p className="text-sm text-foreground">{content.methods}</p>
              </section>
            )}
            {content.contribution && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.summaryContribution')}
                </h4>
                <p className="text-sm text-foreground">{content.contribution}</p>
              </section>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="ghost" size="md" icon={<FileText className="h-3.5 w-3.5" />} onClick={onOpenPdf}>
                {t('workspace.openPdf')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {summaryError ? (
              <div className="flex items-start gap-1.5 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
                <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{summaryError}</span>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('workspace.summarizeHint')}</p>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" size="md" icon={<Sparkle className="h-3.5 w-3.5" />} onClick={onSummarize}>
                {summaryError ? t('workspace.retry') : t('workspace.aiSummary')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
