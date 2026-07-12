import { forwardRef, type HTMLAttributes } from 'react'

export type CardVariant = 'default' | 'elevated' | 'outlined'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  hoverable?: boolean
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'border border-border bg-panel shadow-sm',
  elevated: 'border border-border bg-panel shadow-md',
  outlined: 'border border-border bg-panel',
}

export function cardClassName(
  variant: CardVariant = 'default',
  hoverable = false,
  extra?: string
): string {
  return [
    'card rounded-xl',
    VARIANT_CLASSES[variant],
    hoverable ? 'transition-colors hover:border-accent' : '',
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'default', hoverable = false, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cardClassName(variant, hoverable, className)}
      {...props}
    />
  )
})
