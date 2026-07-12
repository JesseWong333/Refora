import type { ReactNode } from 'react'

export function SidebarItem({
  icon,
  label,
  muted = false,
  active = false,
  disabled = false,
  title,
  onClick,
  onContextMenu,
  onDragOver,
  onDrop
}: {
  icon?: ReactNode
  label: string
  muted?: boolean
  active?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}) {
  return (
    <div
      className={`sidebar-item ${
        active ? 'sidebar-item-active' : muted ? 'text-muted' : 'text-foreground'
      } ${disabled ? 'pointer-events-none opacity-40' : ''}`}
      title={title}
      onClick={disabled ? undefined : onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' && onClick) onClick()
      }}
    >
      {icon && <span className="flex-shrink-0 opacity-70">{icon}</span>}
      <span className="truncate">{label}</span>
    </div>
  )
}

export function SidebarSection({
  title,
  onContextMenu,
  action,
  children
}: {
  title: string
  onContextMenu?: (e: React.MouseEvent) => void
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-label font-semibold uppercase tracking-wide text-muted cursor-context-menu"
        onContextMenu={onContextMenu}
      >
        <span className="flex-1">{title}</span>
        {action}
      </div>
      <div className="px-1">{children}</div>
    </div>
  )
}
