import { create } from 'zustand'

interface OcrReaderState {
  documentId: string | null
  resultKey: string | null
  title: string
  open: (documentId: string, resultKey: string, title: string) => void
  close: () => void
}

export const useOcrReaderStore = create<OcrReaderState>((set) => ({
  documentId: null,
  resultKey: null,
  title: '',
  open: (documentId, resultKey, title) => set({ documentId, resultKey, title }),
  close: () => set({ documentId: null, resultKey: null, title: '' })
}))
