import { type ReactNode } from 'react'
import { X } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

export interface PanelTabHeaderProps {
  title: string
  onClose?: () => void
  closeLabel?: string
  closeDisabled?: boolean
  leading?: ReactNode
  actions?: ReactNode
  onTitleClick?: () => void
  titleDisabled?: boolean
}

export function PanelTabHeader({
  title,
  onClose,
  closeLabel,
  closeDisabled = false,
  leading,
  actions,
  onTitleClick,
  titleDisabled = false
}: PanelTabHeaderProps) {
  const { t } = useTranslation()
  const resolvedCloseLabel = closeLabel ?? t('common.close')
  const titleClassName = 'min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground'

  return (
    <div
      className="drag-region relative z-30 flex h-8 shrink-0 items-end border-b border-border bg-background"
      data-testid="panel-tab-header"
    >
      <div
        className="-mb-px flex h-8 w-[min(320px,65%)] min-w-0 items-center gap-2 rounded-tr-xl border border-l-0 border-t-0 border-border border-b-background bg-background pl-4 pr-2"
        data-testid="panel-tab"
      >
        {leading ? (
          <div className="no-drag flex shrink-0 items-center gap-0.5" data-testid="panel-tab-leading">
            {leading}
          </div>
        ) : null}
        {onTitleClick ? (
          <button
            type="button"
            className={`no-drag ${titleClassName} transition-colors duration-150 hover:text-accent disabled:opacity-40`}
            onClick={onTitleClick}
            disabled={titleDisabled}
            title={title}
          >
            {title}
          </button>
        ) : (
          <span className={titleClassName} title={title}>{title}</span>
        )}
        {onClose ? (
          <button
            type="button"
            className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            onClick={onClose}
            disabled={closeDisabled}
            title={resolvedCloseLabel}
            aria-label={resolvedCloseLabel}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {actions ? (
        <div
          className="no-drag ml-auto flex h-full shrink-0 items-center gap-1 px-3"
          data-testid="panel-tab-actions"
        >
          {actions}
        </div>
      ) : null}
    </div>
  )
}
