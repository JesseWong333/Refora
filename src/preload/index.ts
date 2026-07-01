import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '../shared/ipc-channels'
import type {
  BootstrapData,
  Category,
  Document,
  DocumentPatch,
  EventChannel,
  ImportProgress,
  ListFilter,
  Result,
  ScholarNoteApi,
  SearchResult,
  WatchFolder
} from '../shared/ipc-types'

type Envelope<T> = Result<T>

function unwrap<T>(r: Envelope<T>): T {
  if (!r.ok) {
    throw { code: r.error.code, message: r.error.message }
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

const api: ScholarNoteApi = {
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
    openPdf: (id: string) => invoke<Document>(IpcChannel.DocumentsOpenPdf, id),
    openInFinder: (id: string) => invoke<void>(IpcChannel.DocumentsOpenInFinder, id),
    refreshMetadata: (id: string) => invoke<Document>(IpcChannel.DocumentsRefreshMetadata, id),
    relocateFile: (id: string, newPath: string) =>
      invoke<Document>(IpcChannel.DocumentsRelocateFile, id, newPath),
    restoreFile: (id: string) => invoke<Document>(IpcChannel.DocumentsRestoreFile, id),
    folderGroups: () => invoke<Array<{path: string; count: number}>>(IpcChannel.DocumentsFolderGroups)
  },

  import: {
    addFiles: (paths: string[]) => invoke<string[]>(IpcChannel.ImportAddFiles, paths),
    addFolder: (dir: string) => invoke<string[]>(IpcChannel.ImportAddFolder, dir),
    fromJson: (file: string) => invoke<number>(IpcChannel.ImportFromJson, file)
  },

  categories: {
    list: () => invoke<Category[]>(IpcChannel.CategoriesList),
    create: (name: string, moveToLibrary?: number) =>
      invoke<Category>(IpcChannel.CategoriesCreate, name, moveToLibrary),
    rename: (id: string, name: string) => invoke<void>(IpcChannel.CategoriesRename, id, name),
    delete: (id: string) => invoke<void>(IpcChannel.CategoriesDelete, id),
    setMoveToLibrary: (id: string, value: number | null) =>
      invoke<void>(IpcChannel.CategoriesSetMoveToLibrary, id, value),
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

  export: {
    toJson: () => invoke<string>(IpcChannel.ExportToJson),
    toBibtex: (ids: string[]) => invoke<string>(IpcChannel.ExportToBibtex, ids)
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
    off: (channel: EventChannel, cb: unknown) => unsubscribe(channel, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
