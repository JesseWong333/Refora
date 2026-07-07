import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Modal, Button } from '@lobehub/ui'
import { useDocumentStore } from '../store/documentStore'

export default function ConfirmDialog() {
  const { t } = useTranslation()
  const confirmDelete = useDocumentStore((s) => s.confirmDelete)
  const confirmDeleteAction = useDocumentStore((s) => s.confirmDeleteAction)
  const cancelDelete = useDocumentStore((s) => s.cancelDelete)

  const message =
    confirmDelete && confirmDelete.message.length > 0
      ? confirmDelete.message
      : confirmDelete && confirmDelete.ids.length > 1
        ? t('dialog.deleteConfirmBulk', { count: confirmDelete.ids.length })
        : t('dialog.deleteConfirm')

  return (
    <Modal
      open={confirmDelete !== null}
      onCancel={cancelDelete}
      title={t('dialog.deleteTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={cancelDelete}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirmDeleteAction} danger>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {t('common.delete')}
          </Button>
        </div>
      }
      destroyOnClose
    >
      <p className="text-sm text-foreground">{message}</p>
    </Modal>
  )
}
