import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback } from 'react'
import { Plus, X } from 'lucide-react'
import type { WatchFolder } from '../../shared/ipc-types'
import { api } from '../ipc'

interface WatchFoldersSettingsProps {
  open: boolean
  onClose: () => void
}

export default function WatchFoldersSettings({ open, onClose }: WatchFoldersSettingsProps) {
  const { t } = useTranslation()
  const [folders, setFolders] = useState<WatchFolder[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchFolders = useCallback(async () => {
    try {
      const list = await api.watch.list()
      setFolders(list)
    } catch {
      setFolders([])
    }
  }, [])

  useEffect(() => {
    if (open) {
      setError(null)
      void fetchFolders()
    }
  }, [open, fetchFolders])

  if (!open) return null

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleAdd = async () => {
    setError(null)
    try {
      await api.watch.add('')
      void fetchFolders()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg) setError(msg)
    }
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await api.watch.toggle(id, enabled)
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, enabled: enabled ? 1 : 0 } : f))
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await api.watch.remove(id)
      setFolders((prev) => prev.filter((f) => f.id !== id))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    }
  }

  return (
    <div className="dialog-overlay" onClick={handleBackdrop}>
      <div className="dialog-panel w-96" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 text-sm font-semibold text-foreground">
          {t('settings.watchFolders')}
        </div>

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {folders.length === 0 && (
            <div className="py-2 text-center text-xs italic text-muted">
              {t('sidebar.emptyCategories')}
            </div>
          )}
          {folders.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover"
            >
              <label className="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  className="m-0"
                  checked={f.enabled === 1}
                  onChange={() => handleToggle(f.id, f.enabled !== 1)}
                />
              </label>
              <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                {f.path}
              </span>
              <button
                className="rounded-lg p-1 text-muted hover:bg-panel-2 hover:text-error"
                onClick={() => handleRemove(f.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg bg-panel-2 px-4 py-2 text-xs text-foreground hover:bg-hover"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs text-white hover:opacity-90"
            onClick={handleAdd}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}
