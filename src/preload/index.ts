import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  AgentTraceStep,
  AiProvider,
  AiProviderInput,
  AiProviderPatch,
  AiReport,
  AiSummary,
  BootstrapData,
  Category,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatSendRequest,
  ChatThread,
  ChatTokenEvent,
  ChatTraceEvent,
  Document,
  DocumentPatch,
  EventChannel,
  ImportProgress,
  LibrarySwitchResult,
  ListFilter,
  ListModelsRequest,
  ListModelsResult,
  Result,
  ReforaApi,
  SearchResult,
  SummaryErrorEvent,
  WatchFolder,
  Workspace,
  WorkspaceItem,
  WorkspaceItemKind
} from '../shared/ipc-types'

class IpcResponseError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'IpcResponseError'
    this.code = code
  }
}

type Envelope<T> = Result<T>

function unwrap<T>(r: Envelope<T>): T {
  if (!r.ok) {
    throw new IpcResponseError(r.error.code, r.error.message)
  }
  return r.data
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((r) => unwrap<T>(r as Envelope<T>))
}

const subscriptions = new Map<unknown, { ipcListener: (...args: unknown[]) => void }>()

function subscribe<T>(channel: string, cb: (payload: T) => void): void {
  const ipcListener = (...args: unknown[]): void => cb(args[1] as T)
  subscriptions.set(cb, { ipcListener })
  ipcRenderer.on(channel, ipcListener)
}

function unsubscribe(channel: string, cb: unknown): void {
  const sub = subscriptions.get(cb)
  if (sub) {
    ipcRenderer.removeListener(channel, sub.ipcListener)
    subscriptions.delete(cb)
  }
}

const api: ReforaApi = {
  getBootstrap: () => invoke<BootstrapData>(IpcChannel.Bootstrap),

  documents: {
    list: (filter: ListFilter) => invoke<Document[]>(IpcChannel.DocumentsList, filter),
    search: (q: string) => invoke<SearchResult>(IpcChannel.DocumentsSearch, q),
    get: (id: string) => invoke<Document | null>(IpcChannel.DocumentsGet, id),
    update: (id: string, patch: DocumentPatch) =>
      invoke<Document>(IpcChannel.DocumentsUpdate, id, patch),
    setStarred: (id: string, value: boolean) =>
      invoke<void>(IpcChannel.DocumentsSetStarred, id, value),
    delete: (id: string) => invoke<void>(IpcChannel.DocumentsDelete, id),
    bulkDelete: (ids: string[]) => invoke<void>(IpcChannel.DocumentsBulkDelete, ids),
    bulkCategorize: (ids: string[], catId: string) =>
      invoke<void>(IpcChannel.DocumentsBulkCategorize, ids, catId),
    bulkRefreshMetadata: (ids: string[]) =>
      invoke<void>(IpcChannel.DocumentsBulkRefreshMetadata, ids),
    countPendingMetadata: () => invoke<number>(IpcChannel.DocumentsCountPendingMetadata),
    openPdf: (id: string) => invoke<Document>(IpcChannel.DocumentsOpenPdf, id),
    openInFinder: (id: string) => invoke<void>(IpcChannel.DocumentsOpenInFinder, id),
    refreshMetadata: (id: string) => invoke<Document>(IpcChannel.DocumentsRefreshMetadata, id),
    relocateFile: (id: string, newPath: string) =>
      invoke<Document>(IpcChannel.DocumentsRelocateFile, id, newPath),
    restoreFile: (id: string) => invoke<Document>(IpcChannel.DocumentsRestoreFile, id)
  },

  import: {
    addFiles: (paths: string[]) => invoke<string[]>(IpcChannel.ImportAddFiles, paths),
    addFolder: (dir: string) => invoke<string[]>(IpcChannel.ImportAddFolder, dir),
    fromJson: (file: string) => invoke<number>(IpcChannel.ImportFromJson, file)
  },

  categories: {
    list: () => invoke<Category[]>(IpcChannel.CategoriesList),
    create: (name: string) =>
      invoke<Category>(IpcChannel.CategoriesCreate, name),
    rename: (id: string, name: string) => invoke<void>(IpcChannel.CategoriesRename, id, name),
    delete: (id: string) => invoke<void>(IpcChannel.CategoriesDelete, id),
    assign: (docId: string, catId: string) =>
      invoke<void>(IpcChannel.CategoriesAssign, docId, catId),
    unassign: (docId: string, catId: string) =>
      invoke<void>(IpcChannel.CategoriesUnassign, docId, catId)
  },

  watch: {
    list: () => invoke<WatchFolder[]>(IpcChannel.WatchList),
    add: (path: string) => invoke<WatchFolder>(IpcChannel.WatchAdd, path),
    remove: (id: string) => invoke<void>(IpcChannel.WatchRemove, id),
    toggle: (id: string, enabled: boolean) => invoke<void>(IpcChannel.WatchToggle, id, enabled)
  },

  settings: {
    get: <T>(key: string, defaultValue: T) =>
      invoke<T>(IpcChannel.SettingsGet, key, defaultValue),
    set: (key: string, value: unknown) => invoke<void>(IpcChannel.SettingsSet, key, value)
  },

  dialog: {
    openDirectory: () => invoke<string | null>(IpcChannel.DialogOpenDirectory)
  },

  library: {
    switch: (path: string) => invoke<LibrarySwitchResult>(IpcChannel.LibrarySwitch, path)
  },

  getPathForFile: (file: unknown) => webUtils.getPathForFile(file as File),

  export: {
    toJson: () => invoke<string>(IpcChannel.ExportToJson),
    toBibtex: (ids: string[]) => invoke<string>(IpcChannel.ExportToBibtex, ids),
    toBibtexString: (ids: string[]) => invoke<string>(IpcChannel.ExportBibtexString, ids)
  },

  workspaces: {
    list: () => invoke<Workspace[]>(IpcChannel.WorkspacesList),
    create: (name: string) => invoke<Workspace>(IpcChannel.WorkspacesCreate, name),
    rename: (id: string, name: string) => invoke<void>(IpcChannel.WorkspacesRename, id, name),
    delete: (id: string) => invoke<void>(IpcChannel.WorkspacesDelete, id)
  },

  workspaceItems: {
    list: (workspaceId: string) =>
      invoke<WorkspaceItem[]>(IpcChannel.WorkspaceItemsList, workspaceId),
    add: (workspaceId: string, kind: WorkspaceItemKind, ids: string[]) =>
      invoke<WorkspaceItem[]>(IpcChannel.WorkspaceItemsAdd, workspaceId, kind, ids),
    remove: (itemId: string) => invoke<void>(IpcChannel.WorkspaceItemsRemove, itemId),
    reorder: (workspaceId: string, orderedIds: string[]) =>
      invoke<void>(IpcChannel.WorkspaceItemsReorder, workspaceId, orderedIds)
  },

  aiProviders: {
    list: () => invoke<AiProvider[]>(IpcChannel.AiProvidersList),
    create: (input: AiProviderInput) =>
      invoke<AiProvider>(IpcChannel.AiProvidersCreate, input),
    update: (id: string, patch: AiProviderPatch) =>
      invoke<AiProvider>(IpcChannel.AiProvidersUpdate, id, patch),
    delete: (id: string) => invoke<void>(IpcChannel.AiProvidersDelete, id),
    test: (id: string) =>
      invoke<{ ok: boolean; models?: string[] }>(IpcChannel.AiProvidersTest, id),
    listModels: (req: ListModelsRequest) =>
      invoke<ListModelsResult>(IpcChannel.AiProvidersListModels, req)
  },

  ai: {
    docTextGet: (docId: string) => invoke<string>(IpcChannel.AiDocTextGet, docId),
    summarize: (docId: string) => invoke<void>(IpcChannel.AiSummarize, docId),
    summaryGet: (docId: string) => invoke<AiSummary | null>(IpcChannel.AiSummaryGet, docId),
    chatSend: (req: ChatSendRequest) =>
      invoke<{ threadId: string }>(IpcChannel.AiChatSend, req),
    chatHistory: (threadId: string) => invoke<ChatMessage[]>(IpcChannel.AiChatHistory, threadId),
    chatThreads: (workspaceId: string) =>
      invoke<ChatThread[]>(IpcChannel.AiChatThreads, workspaceId),
    chatTraces: (threadId: string) =>
      invoke<AgentTraceStep[]>(IpcChannel.AiChatTraces, threadId),
    chatCancel: (threadId: string) => invoke<void>(IpcChannel.AiChatCancel, threadId)
  },

  reports: {
    list: (workspaceId: string) => invoke<AiReport[]>(IpcChannel.AiReportsList, workspaceId),
    delete: (id: string) => invoke<void>(IpcChannel.AiReportsDelete, id)
  },

  events: {
    onDocumentUpdated: (cb: (doc: Document) => void) =>
      subscribe(IpcChannel.EventDocumentUpdated, cb),
    onImportProgress: (cb: (payload: ImportProgress) => void) =>
      subscribe(IpcChannel.EventImportProgress, cb),
    onImportToast: (cb: (message: string) => void) =>
      subscribe(IpcChannel.EventImportToast, cb),
    onMenuExportBibtex: (cb: () => void) =>
      subscribe(IpcChannel.EventMenuExportBibtex, cb),
    onLibraryScanning: (cb: (payload: ImportProgress) => void) =>
      subscribe(IpcChannel.EventLibraryScanning, cb),
    onLibrarySwitched: (cb: (payload: LibrarySwitchResult) => void) =>
      subscribe(IpcChannel.EventLibrarySwitched, cb),
    onAiSummaryUpdated: (cb: (docId: string) => void) =>
      subscribe(IpcChannel.EventAiSummaryUpdated, cb),
    onAiSummaryError: (cb: (payload: SummaryErrorEvent) => void) =>
      subscribe(IpcChannel.EventAiSummaryError, cb),
    onAiChatToken: (cb: (payload: ChatTokenEvent) => void) =>
      subscribe(IpcChannel.EventAiChatToken, cb),
    onAiChatDone: (cb: (payload: ChatDoneEvent) => void) =>
      subscribe(IpcChannel.EventAiChatDone, cb),
    onAiChatError: (cb: (payload: ChatErrorEvent) => void) =>
      subscribe(IpcChannel.EventAiChatError, cb),
    onAiChatTrace: (cb: (payload: ChatTraceEvent) => void) =>
      subscribe(IpcChannel.EventAiChatTrace, cb),
    onAiReportCreated: (cb: (report: AiReport) => void) =>
      subscribe(IpcChannel.EventAiReportCreated, cb),
    off: (channel: EventChannel, cb: unknown) => unsubscribe(channel, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
