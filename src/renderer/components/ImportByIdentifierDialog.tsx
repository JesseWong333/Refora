import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@lobehub/ui'
import { PaperclipHorizontal } from '@phosphor-icons/react'
import { Button as UiButton, Input } from './ui'
import { useDocumentStore } from '../store/documentStore'
import { errorMessage } from '../../shared/ipc-types'
import { api } from '../ipc'

interface ImportByIdentifierDialogProps {
  open: boolean
  onClose: () => void
}

export default function ImportByIdentifierDialog({ open, onClose }: ImportByIdentifierDialogProps) {
  const { t } = useTranslation()
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const fetchDocuments = useDocumentStore((s) => s.fetchDocuments)

  const handleClose = useCallback(() => {
    if (loading) return
    setIdentifier('')
    onClose()
  }, [loading, onClose])

  const handleImport = useCallback(async () => {
    const trimmed = identifier.trim()
    if (!trimmed || loading) return

    setLoading(true)
    try {
      const result = await api.import.fromIdentifier(trimmed)
      if (result.added.length > 0) {
        useDocumentStore.getState().showToast(t('identifierImport.success'))
      } else {
        useDocumentStore.getState().showToast(
          result.message ?? t('identifierImport.failed', { message: '' })
        )
      }
      void fetchDocuments()
      setIdentifier('')
      onClose()
    } catch (e) {
      useDocumentStore.getState().showToast(
        t('identifierImport.failed', { message: errorMessage(e, '') })
      )
    } finally {
      setLoading(false)
    }
  }, [identifier, loading, fetchDocuments, onClose, t])

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('identifierImport.title')}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <UiButton variant="ghost" size="md" onClick={handleClose} disabled={loading}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            variant="primary"
            size="md"
            icon={loading ? undefined : <PaperclipHorizontal className="h-3.5 w-3.5" />}
            loading={loading}
            disabled={!identifier.trim()}
            onClick={handleImport}
          >
            {loading ? t('identifierImport.importing') : t('identifierImport.import')}
          </UiButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder={t('identifierImport.placeholder')}
          onPressEnter={handleImport}
          disabled={loading}
        />
        <p className="text-xs text-muted leading-relaxed">
          {t('identifierImport.hint')}
        </p>
      </div>
    </Modal>
  )
}
