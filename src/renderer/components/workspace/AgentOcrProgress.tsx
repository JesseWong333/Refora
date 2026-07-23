import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OcrCompletedEvent,
  OcrErrorEvent,
  OcrJob,
  OcrProgressEvent
} from '../../../shared/mineru-types'
import { IpcChannel } from '../../../shared/ipc-channels'
import { api } from '../../ipc'
import OcrProgressCard from '../OcrProgressCard'

export default function AgentOcrProgress({ documentId }: { documentId: string }) {
  const { t } = useTranslation()
  const [job, setJob] = useState<OcrJob | null>(null)

  useEffect(() => {
    let disposed = false
    let receivedLiveEvent = false
    setJob(null)

    const onProgress = (payload: OcrProgressEvent) => {
      if (payload.job.documentId !== documentId) return
      receivedLiveEvent = true
      setJob(payload.job)
    }
    const onCompleted = (payload: OcrCompletedEvent) => {
      if (payload.documentId !== documentId) return
      receivedLiveEvent = true
      setJob(null)
    }
    const onError = (payload: OcrErrorEvent) => {
      if (payload.documentId !== documentId) return
      receivedLiveEvent = true
      setJob(null)
    }
    api.events.onOcrProgress(onProgress)
    api.events.onOcrCompleted(onCompleted)
    api.events.onOcrError(onError)
    void api.ocr.getState(documentId).then((state) => {
      if (
        !disposed &&
        !receivedLiveEvent &&
        state.activeJob?.documentId === documentId
      ) {
        setJob(state.activeJob)
      }
    }).catch(() => undefined)
    return () => {
      disposed = true
      api.events.off(IpcChannel.EventOcrProgress, onProgress)
      api.events.off(IpcChannel.EventOcrCompleted, onCompleted)
      api.events.off(IpcChannel.EventOcrError, onError)
    }
  }, [documentId])

  if (!job) return null
  return (
    <section aria-label={t('workspace.chat.ocrProgress', 'OCR progress')}>
      <OcrProgressCard
        job={job}
        className="border border-border bg-panel shadow-lg"
      />
    </section>
  )
}
