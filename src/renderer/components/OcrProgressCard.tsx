import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OcrJob } from '../../shared/mineru-types'
import { formatElapsedClock } from '../utils/format'
import { Button } from './ui'

export default function OcrProgressCard({
  job,
  onCancel,
  className = ''
}: {
  job: OcrJob
  onCancel?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    setNow(Date.now())
    if (job.status !== 'queued' && job.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job.id, job.status])

  const elapsed = formatElapsedClock(now - (job.startedAt ?? job.createdAt))

  return (
    <div className={`flex flex-col gap-2 rounded-lg bg-panel-2 px-3 py-2 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-xs text-foreground">
        <span>{t('ocr.processing', { stage: t(`ocr.stage.${job.stage}`) })}</span>
        <span className="text-muted">
          {job.progress != null ? `${Math.round(job.progress * 100)}% · ` : ''}
          {t('ocr.elapsed', { time: elapsed })}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background">
        <div
          className={`h-full rounded-full bg-accent ${
            job.progress == null
              ? 'mineru-progress-indeterminate'
              : 'transition-[width] duration-300'
          }`}
          style={job.progress == null
            ? undefined
            : { width: `${Math.max(2, Math.min(100, job.progress * 100))}%` }}
        />
      </div>
      {onCancel && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onCancel}>
          {t('ocr.cancel')}
        </Button>
      )}
    </div>
  )
}
