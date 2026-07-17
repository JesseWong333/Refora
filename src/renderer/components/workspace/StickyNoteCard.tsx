import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { showContextMenu } from '@lobehub/ui'
import type { ContextMenuItem } from '@lobehub/ui'
import { Copy, Trash } from '@phosphor-icons/react'
import { motion, MotionConfig } from 'motion/react'
import { cardClassName } from '../ui'
import type { WorkspaceNote, WorkspaceNotePatch } from '../../../shared/ipc-types'

interface StickyNoteCardProps {
  note: WorkspaceNote
  autoFocus?: boolean
  onAutoFocusHandled?: () => void
  onDelete: () => void
  onUpdate: (id: string, patch: WorkspaceNotePatch) => Promise<boolean>
  onCopy?: (text: string) => void
}

const SAVE_DELAY = 450

export default function StickyNoteCard({
  note,
  autoFocus = false,
  onAutoFocusHandled,
  onDelete,
  onUpdate,
  onCopy
}: StickyNoteCardProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(note.contentMd)
  const [saveError, setSaveError] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveSequenceRef = useRef<Promise<void>>(Promise.resolve())
  const latestDraftRef = useRef(note.contentMd)
  const lastSavedRef = useRef(note.contentMd)
  const dirtyRef = useRef(false)

  useEffect(() => {
    latestDraftRef.current = note.contentMd
    lastSavedRef.current = note.contentMd
    dirtyRef.current = false
    setDraft(note.contentMd)
    setSaveError(false)
  }, [note.id])

  useEffect(() => {
    if (dirtyRef.current || note.contentMd === latestDraftRef.current) return
    latestDraftRef.current = note.contentMd
    lastSavedRef.current = note.contentMd
    setDraft(note.contentMd)
  }, [note.contentMd])

  useEffect(() => {
    if (!autoFocus) return
    textareaRef.current?.focus()
    onAutoFocusHandled?.()
  }, [autoFocus, onAutoFocusHandled])

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
  }, [])

  const persist = useCallback((value: string) => {
    if (value === lastSavedRef.current) return
    saveSequenceRef.current = saveSequenceRef.current.then(async () => {
      if (value === lastSavedRef.current) return
      const saved = await onUpdate(note.id, { contentMd: value })
      if (!saved) {
        setSaveError(true)
        return
      }
      lastSavedRef.current = value
      setSaveError(false)
      if (latestDraftRef.current === value) dirtyRef.current = false
    })
  }, [note.id, onUpdate])

  const scheduleSave = useCallback((value: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      persist(value)
    }, SAVE_DELAY)
  }, [persist])

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const items: ContextMenuItem[] = [
      {
        key: 'copy',
        label: t('workspace.cardCopy'),
        icon: <Copy className="h-3.5 w-3.5" />,
        onClick: () => onCopy?.(latestDraftRef.current)
      },
      { type: 'divider', key: 'divider' },
      {
        key: 'delete',
        label: t('workspace.noteDelete'),
        icon: <Trash className="h-3.5 w-3.5" />,
        onClick: onDelete,
        danger: true
      }
    ]
    showContextMenu(items)
  }

  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        data-card-kind="sticky"
        className={cardClassName('default', false, 'workspace-content-card workspace-content-card--sticky group/card relative flex h-full w-full flex-col gap-2 overflow-hidden p-3')}
        onContextMenu={handleContextMenu}
      >
        <span className="workspace-sticky-fold" />
        <div className="flex shrink-0 items-center gap-2 pr-3">
          <div className="workspace-card-heading flex-1">
            <span className="workspace-card-type-label mb-0">
              {t('workspace.cardTypeSticky')}
            </span>
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted opacity-0 transition-all duration-150 hover:text-error group-hover/card:opacity-100 group-focus-within/card:opacity-100"
            onClick={onDelete}
            title={t('workspace.noteDelete')}
            aria-label={t('workspace.noteDelete')}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          data-card-scroll
          value={draft}
          aria-label={t('workspace.stickyNoteContentLabel')}
          placeholder={t('workspace.stickyNotePlaceholder')}
          spellCheck
          className="workspace-card-scroll min-h-0 flex-1 resize-none overflow-y-auto overscroll-contain border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted/70"
          onWheel={(event) => event.stopPropagation()}
          onChange={(event) => {
            const value = event.target.value
            latestDraftRef.current = value
            dirtyRef.current = true
            setDraft(value)
            scheduleSave(value)
          }}
          onBlur={() => {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current)
              saveTimerRef.current = null
            }
            persist(latestDraftRef.current)
          }}
        />
        {saveError && (
          <p className="shrink-0 text-[10px] text-error">
            {t('workspace.stickyNoteSaveFailed')}
          </p>
        )}
      </motion.div>
    </MotionConfig>
  )
}
