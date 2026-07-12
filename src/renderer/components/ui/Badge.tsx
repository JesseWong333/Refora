import { type HTMLAttributes } from 'react'

export type BadgeVariant = 'default' | 'accent' | 'success' | 'warning' | 'error'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  subtle?: boolean
}

const SOLID_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-panel-2 text-muted',
  accent: 'bg-accent text-white',
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  error: 'bg-error text-white',
}

const SUBTLE_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-panel-2 text-muted',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  error: 'bg-error/15 text-error',
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'text-caption px-1 py-0.5',
  md: 'text-xs px-1.5 py-0.5',
}

export function Badge({
  variant = 'default',
  size = 'sm',
  subtle = false,
  className,
  ...props
}: BadgeProps) {
  const variantClass = subtle ? SUBTLE_CLASSES[variant] : SOLID_CLASSES[variant]
  return (
    <span
      className={[
        'inline-flex items-center rounded font-medium',
        variantClass,
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  )
}
