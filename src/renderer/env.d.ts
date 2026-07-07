import type { ReforaApi } from '../shared/ipc-types'

declare global {
  interface Window {
    api: ReforaApi
    __i18n?: { changeLanguage(lng: string): Promise<unknown> }
  }
}

export {}