import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '@lobehub/ui'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { FileBarChart, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatDate } from '../../utils/format'
import type { AiReport } from '../../../shared/ipc-types'

const REMARK_PLUGINS = [remarkGfm]

const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

interface ReportCardProps {
  report: AiReport
  onDelete: () => void
}

export default function ReportCard({ report, onDelete }: ReportCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const menuItems: ContextMenuItem[] = [
      {
        key: 'delete',
        label: t('workspace.reportDelete'),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        onClick: () => setExpanded(true),
        danger: true
      }
    ]
    showContextMenu(menuItems)
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="card flex h-full w-full cursor-pointer flex-col gap-2 overflow-hidden border-l-2 border-l-accent p-3 transition-colors hover:border-accent"
        onClick={() => setExpanded(true)}
        onContextMenu={handleContextMenu}
      >
        <div className="flex shrink-0 items-start gap-2">
          <FileBarChart className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{report.title}</h3>
            <p className="mt-0.5 text-xs text-muted">{formatDate(report.createdAt)}</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden text-xs text-muted [&_p]:my-0.5 [&_ul]:my-0.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0">
          <div className="line-clamp-[12]">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{report.contentMd}</ReactMarkdown>
          </div>
        </div>
      </motion.div>

      <Modal
        open={expanded}
        onCancel={() => {
          setExpanded(false)
          setConfirmDelete(false)
        }}
        title={report.title}
        width={640}
        footer={
          <div className="flex justify-between">
            <Button
              danger
              onClick={() => {
                if (confirmDelete) {
                  setExpanded(false)
                  setConfirmDelete(false)
                  onDelete()
                } else {
                  setConfirmDelete(true)
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {confirmDelete ? t('common.confirm') : t('workspace.reportDelete')}
            </Button>
            <Button onClick={() => { setExpanded(false); setConfirmDelete(false) }}>
              {t('common.close')}
            </Button>
          </div>
        }
      >
        {confirmDelete && (
          <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-error">
            {t('workspace.reportDeleteConfirm')}
          </div>
        )}
        <p className="mb-3 text-xs text-muted">{formatDate(report.createdAt)}</p>
        <div className="max-h-[60vh] overflow-y-auto text-sm text-foreground [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-panel-2 [&_pre]:p-2 [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-accent [&_a]:underline [&_h1]:mb-2 [&_h1]:font-bold [&_h1]:text-base [&_h2]:mb-2 [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:font-medium [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>{report.contentMd}</ReactMarkdown>
        </div>
      </Modal>
    </>
  )
}
