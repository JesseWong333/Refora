import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconOnly?: boolean
  loading?: boolean
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-6 text-xs gap-1 px-2',
  md: 'h-8 text-xs gap-1.5 px-2.5',
  lg: 'h-10 text-sm gap-2 px-4',
}

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-6 w-6 p-0',
  md: 'h-8 w-8 p-0',
  lg: 'h-10 w-10 p-0',
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:opacity-90',
  secondary: 'bg-panel-2 text-foreground hover:bg-hover active:bg-active border border-border',
  ghost: 'bg-transparent text-foreground hover:bg-hover active:bg-active',
  danger: 'bg-error text-white hover:opacity-90 active:opacity-80',
  link: 'bg-transparent text-accent hover:underline',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'md',
    icon,
    iconOnly = false,
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref
) {
  const isLink = variant === 'link'
  const sizeClass = iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size]
  const variantClass = VARIANT_CLASSES[variant]

  const baseClass = isLink
    ? 'inline-flex items-center gap-1 text-xs transition-colors duration-150'
    : `inline-flex items-center justify-center rounded-lg font-medium no-drag transition-colors duration-150 ${sizeClass} ${variantClass}`

  return (
    <button
      ref={ref}
      type={type}
      className={[
        baseClass,
        'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1',
        'disabled:opacity-40 disabled:pointer-events-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : icon ? (
        <span className="flex shrink-0 items-center">{icon}</span>
      ) : null}
      {children && !iconOnly && <span className="truncate">{children}</span>}
    </button>
  )
})
