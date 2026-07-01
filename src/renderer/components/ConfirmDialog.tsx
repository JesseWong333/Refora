import { useTranslation } from 'react-i18next'
import { useDocumentStore } from '../store/documentStore'

export default function ConfirmDialog() {
  const { t } = useTranslation()
  const confirmDelete = useDocumentStore((s) => s.confirmDelete)
  const confirmDeleteAction = useDocumentStore((s) => s.confirmDeleteAction)
  const cancelDelete = useDocumentStore((s) => s.cancelDelete)

  if (!confirmDelete) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-96 rounded border border-border bg-panel p-4 shadow-lg">
        <p className="text-sm text-foreground">{confirmDelete.message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded bg-panel-2 px-3 py-1.5 text-xs text-foreground hover:bg-hover"
            onClick={cancelDelete}
          >
            {t('common.cancel')}
          </button>
          <button
            className="rounded bg-error px-3 py-1.5 text-xs text-white hover:opacity-90"
            onClick={confirmDeleteAction}
          >
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
