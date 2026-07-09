import { useState } from 'react'
import { Modal } from 'antd'
import { FileBarChart } from 'lucide-react'
import { motion } from 'motion/react'
import { formatDate } from '../../utils/format'
import type { AiReport } from '../../../shared/ipc-types'

interface ReportCardProps {
  report: AiReport
}

export default function ReportCard({ report }: ReportCardProps) {
  const [expanded, setExpanded] = useState(false)

  const paragraphs = report.contentMd
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        className="card flex cursor-pointer flex-col gap-2 border-l-2 border-l-accent p-3 transition-colors hover:border-accent"
        onClick={() => setExpanded(true)}
      >
        <div className="flex items-start gap-2">
          <FileBarChart className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{report.title}</h3>
            <p className="mt-0.5 text-xs text-muted">{formatDate(report.createdAt)}</p>
          </div>
        </div>
        <div className="max-h-28 overflow-hidden text-xs text-muted">
          <p className="line-clamp-5 whitespace-pre-wrap">{report.contentMd}</p>
        </div>
      </motion.div>

      <Modal
        open={expanded}
        onCancel={() => setExpanded(false)}
        title={report.title}
        footer={null}
        width={640}
      >
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
