import { useDocumentStore } from '../../store/documentStore'

export function Toast() {
  const toastMessage = useDocumentStore((s) => s.toastMessage)

  if (!toastMessage) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 animate-slide-up rounded-xl bg-panel px-4 py-2.5 text-xs text-foreground"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      {toastMessage}
    </div>
  )
}
