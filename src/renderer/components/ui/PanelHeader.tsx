import { type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

export interface PanelHeaderProps {
  title?: string
  onClose?: () => void
  actions?: ReactNode
}

export function PanelHeader({ title, onClose, actions }: PanelHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="drag-region flex h-9 shrink-0 items-center gap-2 px-2">
      {title ? (
        <span className="no-drag min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {actions ? <div className="no-drag flex items-center gap-1">{actions}</div> : null}
      {onClose ? (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="no-drag"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  )
}
