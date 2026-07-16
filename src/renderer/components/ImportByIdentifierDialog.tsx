import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@lobehub/ui'
import { FileArrowDown } from '@phosphor-icons/react'
import { Button as UiButton, Input } from './ui'
import { useDocumentStore } from '../store/documentStore'

interface ImportByIdentifierDialogProps {
  open: boolean
  onClose: () => void
}

export default function ImportByIdentifierDialog({ open, onClose }: ImportByIdentifierDialogProps) {
  const { t } = useTranslation()
  const [identifier, setIdentifier] = useState('')
  const importByIdentifier = useDocumentStore((s) => s.importByIdentifier)

  const handleClose = useCallback(() => {
    setIdentifier('')
    onClose()
  }, [onClose])

  const handleImport = useCallback(() => {
    const trimmed = identifier.trim()
    if (!trimmed) return
    importByIdentifier(trimmed)
    setIdentifier('')
    onClose()
  }, [identifier, importByIdentifier, onClose])

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={t('identifierImport.title')}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <UiButton variant="ghost" size="md" onClick={handleClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            variant="primary"
            size="md"
            icon={<FileArrowDown className="h-3.5 w-3.5" />}
            disabled={!identifier.trim()}
            onClick={handleImport}
          >
            {t('identifierImport.import')}
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
        />
        <p className="text-xs text-muted leading-relaxed">
          {t('identifierImport.hint')}
        </p>
      </div>
    </Modal>
  )
}
