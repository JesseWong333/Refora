import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

vi.mock('@emoji-mart/data', () => ({ default: {} }))
vi.mock('@emoji-mart/react', () => ({ default: () => null }))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

const noopPromise = async () => ({ ok: true, data: undefined })

;(window as Record<string, unknown>).api = {
  getBootstrap: async () => ({
    language: 'en',
    windowBounds: null,
    listColumnState: null,
    sidebarCollapsed: false,
    firstRun: false,
    libraryFolderPath: '/fake/library',
    proxyUrl: ''
  }),
  documents: {
    list: async () => ({ ok: true, data: [] }),
    get: async () => ({ ok: false, error: { code: 'not_found', message: 'not found' } }),
    update: noopPromise,
    setStarred: noopPromise,
    delete: noopPromise,
    bulkDelete: noopPromise,
    bulkCategorize: noopPromise,
    bulkRefreshMetadata: noopPromise,
    openPdf: noopPromise,
    refreshMetadata: noopPromise,
    relocateFile: noopPromise,
    restoreFile: noopPromise,
  },
  import: {
    addFiles: async () => ({ ok: true, data: { added: [], skipped: [], errors: [] } }),
    addFolder: async () => ({ ok: true, data: { added: [], skipped: [], errors: [] } }),
    fromJson: noopPromise
  },
  categories: {
    list: async () => ({ ok: true, data: [] }),
    create: noopPromise,
    rename: noopPromise,
    delete: noopPromise,
    assign: noopPromise,
    unassign: noopPromise
  },
  watch: {
    list: async () => ({ ok: true, data: [] }),
    add: noopPromise,
    remove: noopPromise,
    toggle: noopPromise
  },
  settings: {
    get: async () => ({ ok: true, data: null }),
    set: noopPromise
  },
  dialog: {
    openDirectory: async () => null
  },
  getPathForFile: (_file: unknown) => '',
  export: {
    toJson: noopPromise,
    toBibtex: noopPromise
  },
  events: {
    onDocumentUpdated: (_cb: unknown) => { return () => {} },
    onImportProgress: (_cb: unknown) => { return () => {} },
    off: (_channel: string, _cb: unknown) => {}
  }
}
