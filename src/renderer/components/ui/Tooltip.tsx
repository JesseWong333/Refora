import { Tooltip as LobeTooltip } from '@lobehub/ui'
import type { Placement } from '@lobehub/ui'
import type { ReactElement, ReactNode } from 'react'

export interface IconTooltipProps {
  label: ReactNode
  placement?: Placement
  children: ReactElement
  disabled?: boolean
}

export function IconTooltip({ label, placement = 'bottom', children, disabled }: IconTooltipProps) {
  if (disabled || !label) {
    return children
  }
  return (
    <LobeTooltip
      title={<span className="text-[13px]">{label}</span>}
      placement={placement}
      arrow
      openDelay={300}
      closeDelay={80}
    >
      {children}
    </LobeTooltip>
  )
}

export default IconTooltip