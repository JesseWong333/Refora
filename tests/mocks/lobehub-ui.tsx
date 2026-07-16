import type { CSSProperties, ReactNode } from 'react'
import { vi } from 'vitest'

export function Modal({
  children,
  className,
  footer,
  open,
  title
}: {
  children?: ReactNode
  className?: string
  footer?: ReactNode
  open?: boolean
  title?: ReactNode
}) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      className={className}
    >
      {title !== null && title !== undefined && <div>{title}</div>}
      {children}
      {footer}
    </div>
  )
}

export function Button({
  children,
  disabled,
  loading,
  onClick
}: {
  children?: ReactNode
  disabled?: boolean
  loading?: boolean
  onClick?: () => void
}) {
  return (
    <button type="button" disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  )
}

export function Select({
  onChange,
  options = [],
  style,
  value
}: {
  onChange?: (value: string) => void
  options?: Array<{ label: ReactNode; value: string }>
  style?: CSSProperties
  value?: string
}) {
  return (
    <select value={value} style={style} onChange={(event) => onChange?.(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Tooltip({ children }: { children?: ReactNode }) {
  return <>{children}</>
}

export const showContextMenu = vi.fn()
