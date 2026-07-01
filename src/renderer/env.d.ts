import type { ScholarNoteApi } from '../shared/ipc-types'

declare global {
  interface Window {
    api: ScholarNoteApi
    __i18n?: { changeLanguage(lng: string): Promise<unknown> }
  }
}

export {}
