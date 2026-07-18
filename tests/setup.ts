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

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(global as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverMock

const noop = async () => undefined

;(window as Record<string, unknown>).api = {
  getBootstrap: async () => ({
    language: 'en',
    windowBounds: null,
    listColumnState: null,
    sidebarCollapsed: false,
    firstRun: false,
    libraryFolderPath: '/fake/library',
  }),

  documents: {
    list: async () => [],
    counts: async () => ({ all: 0, recentlyRead: 0, recentlyAdded: 0, starred: 0 }),
    search: async () => [],
    get: async () => null,
    update: noop,
    setStarred: noop,
    delete: noop,
    bulkDelete: noop,
    bulkCategorize: noop,
    bulkRefreshMetadata: noop,
    openPdf: noop,
    openInFinder: noop,
    refreshMetadata: noop,
    relocateFile: noop,
    restoreFile: noop,
  },

  search: {
    global: async () => ({ documents: [], workspaceFiles: [], chats: [] }),
  },

  import: {
    addFiles: async () => ({ added: [], skipped: [], errors: [] }),
    addFolder: async () => ({ added: [], skipped: [], errors: [] }),
    fromJson: async () => 0,
    fromZotero: async () => ({ added: 0, skipped: 0, errors: [] }),
    fromMendeley: async () => ({ added: 0, skipped: 0, errors: [] }),
    fromIdentifier: async () => ({ added: [] }),
  },

  categories: {
    list: async () => [],
    create: noop,
    rename: noop,
    delete: noop,
    assign: noop,
    unassign: noop,
  },

  watch: {
    list: async () => [],
    add: noop,
    remove: noop,
    toggle: noop,
  },

  settings: {
    get: async (_key: string, defaultValue: unknown) => defaultValue,
    set: noop,
  },

  dialog: {
    openDirectory: async () => null,
  },

  library: {
    switch: async () => ({
      libraryFolderPath: '/fake/library',
      dbExisted: true,
      scanned: 0,
      imported: 0,
      skipped: 0,
      errors: [],
    }),
  },

  getPathForFile: (_file: unknown) => '',

  export: {
    toJson: async () => '',
    toBibtex: async () => '',
  },

  clipboard: {
    writeText: noop,
    copyMarkdown: noop,
    copyWorkspaceAsset: noop,
  },

  workspaces: {
    list: async () => [],
    create: async (name: string) => ({ id: 'ws', name, createdAt: 0, updatedAt: 0 }),
    rename: noop,
    delete: noop,
  },

  workspaceItems: {
    list: async () => [],
    add: async () => [],
    remove: noop,
    reorder: async () => [],
    resize: async (id: string, width: number, height: number) => ({
      id,
      workspaceId: 'ws',
      kind: 'document' as const,
      docId: 'doc',
      reportId: null,
      noteId: null,
      sortOrder: 0,
      width,
      height,
      x: 0,
      y: 0,
      zIndex: 0,
      addedAt: 0
    }),
    move: async (id: string, x: number, y: number, zIndex: number) => ({
      id,
      workspaceId: 'ws',
      kind: 'document' as const,
      docId: 'doc',
      reportId: null,
      noteId: null,
      sortOrder: 0,
      width: 300,
      height: 200,
      x,
      y,
      zIndex,
      addedAt: 0
    }),
  },

  workspaceAssets: {
    list: async () => [],
    addFiles: async () => ({ imported: [], errors: [] }),
    textPreview: async () => ({ content: '', truncated: false }),
    open: noop,
    reveal: noop,
    delete: noop,
    previewUrl: (id: string) => `refora-asset://asset/${encodeURIComponent(id)}`,
  },

  workspaceNotes: {
    list: async () => [],
    create: async (workspaceId: string, title: string, contentMd: string, noteType: 'markdown' | 'plain') => ({
      id: 'note',
      workspaceId,
      noteType,
      title,
      contentMd,
      createdAt: 0,
      updatedAt: 0
    }),
    update: async (id: string, patch: { title?: string; contentMd?: string }) => ({
      id,
      workspaceId: 'ws',
      noteType: 'markdown' as const,
      title: patch.title ?? '',
      contentMd: patch.contentMd ?? '',
      createdAt: 0,
      updatedAt: 0
    }),
    delete: noop,
  },

  workspaceCanvas: {
    get: async () => ({ panX: 0, panY: 0, zoom: 1 }),
    update: async (_workspaceId: string, viewport: { panX: number; panY: number; zoom: number }) => viewport,
  },

  workspaceConnections: {
    list: async () => [],
    create: async (
      workspaceId: string,
      sourceItemId: string,
      targetItemId: string,
      sourceAnchor: 'top' | 'right' | 'bottom' | 'left',
      targetAnchor: 'top' | 'right' | 'bottom' | 'left'
    ) => ({
      id: 'connection',
      workspaceId,
      sourceItemId,
      targetItemId,
      sourceAnchor,
      targetAnchor,
      createdAt: 0
    }),
    delete: noop,
  },

  aiProviders: {
    list: async () => [],
    create: async (input: { name: string; baseUrl: string; model: string }) => ({
      id: 'p',
      presetId: input.name === 'OpenAI' ? 'openai' : 'custom',
      name: input.name,
      baseUrl: input.baseUrl,
      apiProtocol: 'openai-compatible' as const,
      reasoningControl: 'openai' as const,
      reasoningEffort: 'medium' as const,
      model: input.model,
      baseModel: input.model,
      variant: '',
      variantFormat: 'dash' as const,
      hasKey: false,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    }),
    update: async (id: string) => ({
      id,
      presetId: 'custom',
      name: '',
      baseUrl: '',
      apiProtocol: 'openai-compatible' as const,
      reasoningControl: 'openai' as const,
      reasoningEffort: 'medium' as const,
      model: '',
      baseModel: '',
      variant: '',
      variantFormat: 'dash' as const,
      hasKey: false,
      temperature: null,
      maxTokens: null,
      createdAt: 0
    }),
    delete: noop,
    test: async () => ({ ok: true }),
    listModels: async () => ({ ok: true, models: [] }),
  },

  ai: {
    docTextGet: async () => '',
    summarize: noop,
    summaryGet: async () => null,
    chatSend: async () => ({ threadId: 't' }),
    chatHistory: async () => [],
    chatThreads: async () => [],
    chatTraces: async () => [],
    chatCancel: noop,
    chatDeleteThread: noop,
  },

  reports: {
    list: async () => [],
    update: async (id: string, patch: { title?: string; contentMd?: string }) => ({
      id,
      workspaceId: 'ws',
      title: patch.title ?? '',
      contentMd: patch.contentMd ?? '',
      sourceDocIds: [],
      model: null,
      createdAt: 0
    }),
    delete: noop,
  },

  events: {
    onDocumentUpdated: (_cb: unknown) => undefined,
    onImportProgress: (_cb: unknown) => undefined,
    onImportToast: (_cb: unknown) => undefined,
    onMenuExportBibtex: (_cb: unknown) => undefined,
    onMenuImportZotero: (_cb: unknown) => undefined,
    onMenuImportMendeley: (_cb: unknown) => undefined,
    onMenuImportIdentifier: (_cb: unknown) => undefined,
    onLibraryScanning: (_cb: unknown) => undefined,
    onLibrarySwitched: (_cb: unknown) => undefined,
    onAiSummaryUpdated: (_cb: unknown) => undefined,
    onAiSummaryError: (_cb: unknown) => undefined,
    onAiReportCreated: (_cb: unknown) => undefined,
    onWorkspaceItemsChanged: (_cb: unknown) => undefined,
    onAiChatToken: (_cb: unknown) => undefined,
    onAiChatReasoning: (_cb: unknown) => undefined,
    onAiChatDone: (_cb: unknown) => undefined,
    onAiChatError: (_cb: unknown) => undefined,
    onAiChatTrace: (_cb: unknown) => undefined,
    onAiChatTitleUpdated: (_cb: unknown) => undefined,
    off: (_channel: string, _cb: unknown) => undefined,
  },
}
