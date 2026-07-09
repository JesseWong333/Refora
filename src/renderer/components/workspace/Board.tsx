import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../../store/workspaceStore'

const DOC_MIME = 'application/x-refora-docids'

export default function Board() {
  const { t } = useTranslation()
  const items = useWorkspaceStore((s) => s.items)
  const addDocs = useWorkspaceStore((s) => s.addDocs)
  const fetchItems = useWorkspaceStore((s) => s.fetchItems)

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DOC_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DOC_MIME)
    if (!raw) return
    e.preventDefault()
    try {
      const ids: string[] = JSON.parse(raw)
      if (ids.length > 0) {
        await addDocs(ids)
        await fetchItems()
      }
    } catch {
      void 0
    }
  }

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center"
      onDragOver={handleDragOver}
      onDrop={(e) => void handleDrop(e)}
    >
      <p className="text-sm text-muted">{t('workspace.boardPlaceholder')}</p>
      <p className="text-xs text-muted">
        {t('workspace.itemCount', { count: items.length })}
      </p>
    </div>
  )
}
