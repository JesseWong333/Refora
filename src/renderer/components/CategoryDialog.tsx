import { useTranslation } from 'react-i18next'
import { useState, useEffect, useRef } from 'react'
import type { Category } from '../../shared/ipc-types'

export interface CategoryDialogState {
  mode: 'create' | 'rename'
  category?: Category
}

interface CategoryDialogProps {
  state: CategoryDialogState | null
  onSave: (name: string, moveToLibrary: number | null) => void
  onSetMoveToLibrary: (catId: string, value: number | null) => void
  onClose: () => void
}

export default function CategoryDialog({ state, onSave, onSetMoveToLibrary, onClose }: CategoryDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [moveToLibrary, setMoveToLibrary] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state) {
      setName(state.category?.name ?? '')
      setMoveToLibrary(state.category?.moveToLibrary ?? null)
    }
  }, [state])

  useEffect(() => {
    inputRef.current?.focus()
  }, [state?.mode])

  if (!state) return null

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (state.mode === 'rename' && state.category && trimmed !== state.category.name) {
      onSave(trimmed, moveToLibrary)
    } else if (state.mode === 'create') {
      onSave(trimmed, moveToLibrary)
    }
    if (state.mode === 'rename' && state.category) {
      if (moveToLibrary !== state.category.moveToLibrary) {
        onSetMoveToLibrary(state.category.id, moveToLibrary)
      }
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleBackdrop}
    >
      <div
        className="w-80 rounded border border-border bg-panel p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-semibold text-foreground">
          {state.mode === 'create' ? t('sidebar.createCategory') : t('sidebar.renameCategory')}
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t('sidebar.categoryName')}
            </label>
            <input
              ref={inputRef}
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {t('settings.moveToLibraryOnCategorize')}
            </label>
            <div className="flex flex-col gap-1 text-xs text-foreground">
              {[
                { value: null, label: t('detail.moveToLibraryInherit') },
                { value: 1, label: t('detail.moveToLibraryMove') },
                { value: 0, label: t('detail.moveToLibraryKeep') }
              ].map((opt) => (
                <label key={String(opt.value)} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="moveToLibrary"
                    className="m-0"
                    checked={moveToLibrary === opt.value}
                    onChange={() => setMoveToLibrary(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <button
              className="rounded bg-panel-2 px-3 py-1.5 text-xs text-foreground hover:bg-hover"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90"
              onClick={handleSave}
              disabled={!name.trim()}
            >
              {state.mode === 'create' ? t('common.create') : t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
