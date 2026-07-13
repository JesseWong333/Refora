import { useTranslation } from 'react-i18next'
import { Trash } from '@phosphor-icons/react'
import { Modal } from '@lobehub/ui'
import { Button as UiButton } from './ui'
import { useDocumentStore } from '../store/documentStore'
import { useConfirmStore } from '../store/confirmStore'

export default function ConfirmDialog() {
  const { t } = useTranslation()
  const confirmDelete = useDocumentStore((s) => s.confirmDelete)
  const confirmDeleteAction = useDocumentStore((s) => s.confirmDeleteAction)
  const cancelDelete = useDocumentStore((s) => s.cancelDelete)

  const confirmRequest = useConfirmStore((s) => s.request)
  const dismissConfirm = useConfirmStore((s) => s.dismiss)

  if (confirmRequest) {
    return (
      <Modal
        open
        onCancel={dismissConfirm}
        title={confirmRequest.title}
        footer={
          <div className="flex justify-end gap-2">
            <UiButton variant="ghost" size="md" onClick={dismissConfirm}>
              {confirmRequest.cancelText}
            </UiButton>
            <UiButton
              variant={confirmRequest.danger ? 'danger' : 'primary'}
              size="md"
              icon={confirmRequest.danger ? <Trash className="h-3.5 w-3.5" /> : undefined}
              onClick={() => {
                const fn = confirmRequest.onConfirm
                dismissConfirm()
                fn()
              }}
            >
              {confirmRequest.confirmText}
            </UiButton>
          </div>
        }
        destroyOnClose
      >
        <p className="text-sm text-foreground">{confirmRequest.message}</p>
      </Modal>
    )
  }

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
          <UiButton variant="ghost" size="md" onClick={cancelDelete}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            variant="danger"
            size="md"
            icon={<Trash className="h-3.5 w-3.5" />}
            onClick={confirmDeleteAction}
          >
            {t('common.delete')}
          </UiButton>
        </div>
      }
      destroyOnClose
    >
      <p className="text-sm text-foreground">{message}</p>
    </Modal>
  )
}
