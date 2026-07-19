import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { IconTooltip } from '../ui'

interface WorkspaceNavigationControlsProps {
  onBack?: () => void
  onForward?: () => void
}

export default function WorkspaceNavigationControls({
  onBack,
  onForward
}: WorkspaceNavigationControlsProps) {
  const { t } = useTranslation()

  return (
    <>
      <IconTooltip label={t('workspace.navigateBack')} appearance="sidebar">
        <button
          type="button"
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          onClick={onBack}
          disabled={!onBack}
          aria-label={t('workspace.navigateBack')}
        >
          <CaretLeft className="h-4 w-4" />
        </button>
      </IconTooltip>
      <IconTooltip label={t('workspace.navigateForward')} appearance="sidebar">
        <button
          type="button"
          className="no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          onClick={onForward}
          disabled={!onForward}
          aria-label={t('workspace.navigateForward')}
        >
          <CaretRight className="h-4 w-4" />
        </button>
      </IconTooltip>
    </>
  )
}
