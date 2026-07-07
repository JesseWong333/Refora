import { useTranslation } from 'react-i18next'
import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil } from 'lucide-react'
import { Modal, Button, Input } from '@lobehub/ui'
import type { InputRef } from 'antd/es/input'
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
  const inputRef = useRef<InputRef>(null)

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
    <Modal
      open={state !== null}
      onCancel={onClose}
      title={state.mode === 'create' ? t('sidebar.createCategory') : t('sidebar.renameCategory')}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()} type="primary">
            {state.mode === 'create' ? <Plus className="mr-1.5 h-3.5 w-3.5" /> : <Pencil className="mr-1.5 h-3.5 w-3.5" />}
            {state.mode === 'create' ? t('common.create') : t('common.save')}
          </Button>
        </div>
      }
      destroyOnClose
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t('sidebar.categoryName')}
          </label>
          <Input
            ref={inputRef}
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
          <div className="flex flex-col gap-1.5 text-xs text-foreground">
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
      </div>
    </Modal>
  )
}
