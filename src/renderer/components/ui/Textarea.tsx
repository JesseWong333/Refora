import {
  forwardRef,
  useEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react'

export type TextareaVariant = 'outlined' | 'filled' | 'borderless'
export type TextareaSize = 'sm' | 'md'

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  variant?: TextareaVariant
  textareaSize?: TextareaSize
  error?: boolean
  autoResize?: boolean
}

const SIZE_CLASSES: Record<TextareaSize, string> = {
  sm: 'text-xs px-2.5 py-1.5',
  md: 'text-sm px-3 py-1.5',
}

const VARIANT_CLASSES: Record<TextareaVariant, string> = {
  outlined:
    'border border-border bg-background hover:border-accent focus:border-accent',
  filled:
    'border border-transparent bg-background hover:border-border focus:border-accent',
  borderless:
    'border border-transparent bg-transparent hover:bg-hover focus:bg-hover',
}

const BASE_CLASS =
  'w-full rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent no-drag transition-colors duration-150'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      variant = 'filled',
      textareaSize = 'md',
      error = false,
      autoResize = false,
      className,
      onChange,
      ...props
    },
    ref
  ) {
    const internalRef = useRef<HTMLTextAreaElement | null>(null)

    const setRef = (el: HTMLTextAreaElement | null) => {
      internalRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    }

    useEffect(() => {
      if (autoResize && internalRef.current) {
        const el = internalRef.current
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
      }
    }, [autoResize, props.value])

    return (
      <textarea
        ref={setRef}
        className={[
          BASE_CLASS,
          SIZE_CLASSES[textareaSize],
          error
            ? 'border-error focus:border-error focus:ring-error'
            : VARIANT_CLASSES[variant],
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        onChange={(e) => {
          if (autoResize && internalRef.current) {
            const el = internalRef.current
            el.style.height = 'auto'
            el.style.height = el.scrollHeight + 'px'
          }
          onChange?.(e)
        }}
        {...props}
      />
    )
  }
)
