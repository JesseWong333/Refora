import '@testing-library/jest-dom/vitest'

const noopPromise = async () => ({ ok: true, data: undefined })

;(window as Record<string, unknown>).api = {
  getBootstrap: async () => ({
    language: 'en',
    windowBounds: null,
    listColumnState: null,
    sidebarCollapsed: false,
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
    folderGroups: async () => ({ ok: true, data: [] })
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
    setMoveToLibrary: noopPromise,
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
