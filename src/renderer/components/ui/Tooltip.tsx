import { Tooltip as LobeTooltip } from '@lobehub/ui'
import type { Placement } from '@lobehub/ui'
import type { ReactElement, ReactNode } from 'react'

export interface IconTooltipProps {
  label: ReactNode
  placement?: Placement
  children: ReactElement
  disabled?: boolean
  appearance?: 'default' | 'sidebar'
  shortcut?: string
}

export function IconTooltip({
  label,
  placement = 'bottom',
  children,
  disabled,
  appearance = 'default',
  shortcut,
}: IconTooltipProps) {
  if (disabled || !label) {
    return children
  }

  const isSidebarTooltip = appearance === 'sidebar'

  return (
    <LobeTooltip
      title={
        <span
          className={
            isSidebarTooltip
              ? 'inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium leading-5'
              : 'text-[13px]'
          }
        >
          <span>{label}</span>
          {isSidebarTooltip && shortcut ? (
            <kbd className="inline-flex h-[22px] shrink-0 items-center justify-center rounded-md bg-panel-2 px-[7px] text-[11px] font-medium leading-none text-foreground">
              {shortcut}
            </kbd>
          ) : null}
        </span>
      }
      placement={placement}
      arrow={!isSidebarTooltip}
      openDelay={300}
      closeDelay={80}
      styles={
        isSidebarTooltip
          ? {
              root: {
                width: 'max-content',
                maxWidth: 'calc(100vw - 16px)',
                border: '1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent)',
                borderRadius: '14px',
                color: 'var(--color-foreground)',
                background: 'var(--color-background)',
                boxShadow: '0 2px 6px rgb(0 0 0 / 8%), 0 8px 20px rgb(0 0 0 / 8%)',
              },
              content: {
                gap: '8px',
                padding: '8px 12px',
              },
            }
          : undefined
      }
    >
      {children}
    </LobeTooltip>
  )
}

export default IconTooltip
