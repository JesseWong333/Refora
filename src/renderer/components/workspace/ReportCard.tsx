import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Button } from '@lobehub/ui'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { FileBarChart, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { formatDate } from '../../utils/format'
import type { AiReport } from '../../../shared/ipc-types'

interface ReportCardProps {
  report: AiReport
  onDelete: () => void
}

export default function ReportCard({ report, onDelete }: ReportCardProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const paragraphs = report.contentMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

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
        <div className="min-h-0 flex-1 overflow-hidden text-xs text-muted">
          <p className="line-clamp-[12] whitespace-pre-wrap">{report.contentMd}</p>
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
        <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm text-foreground">
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-wrap">{p}</p>
            ))
          ) : (
            <p className="whitespace-pre-wrap text-muted">{report.contentMd}</p>
          )}
        </div>
      </Modal>
    </>
  )
}
