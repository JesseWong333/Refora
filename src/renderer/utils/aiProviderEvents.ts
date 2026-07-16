export const AI_PROVIDERS_CHANGED_EVENT = 'refora:ai-providers-changed'

export function notifyAiProvidersChanged(): void {
  window.dispatchEvent(new Event(AI_PROVIDERS_CHANGED_EVENT))
}
