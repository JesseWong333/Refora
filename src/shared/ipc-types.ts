export interface IpcError {
  code: string
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export type ListMode =
  | 'all'
  | 'recentlyRead'
  | 'recentlyAdded'
  | 'starred'
  | 'category'

export type SortField = 'title' | 'authors' | 'year' | 'venue' | 'addedAt' | 'filePath'

export interface ListFilter {
  mode: ListMode
  categoryId?: string
  sort?: { field: SortField; dir: 'asc' | 'desc' }
}

export type EditableField =
  | 'title'
  | 'authors'
  | 'year'
  | 'venue'
  | 'volume'
  | 'abstract'
  | 'keywords'
  | 'url'
  | 'doi'
  | 'note'

export type MetadataStatus = 'pending' | 'done' | 'failed'
export type MetadataSource = 'pdf' | 'crossref' | 'arxiv' | 'dblp' | 'manual'

export interface RemoteValue {
  value: string
  source: MetadataSource
}

export type RemoteValues = Partial<Record<EditableField, RemoteValue>>

export interface Category {
  id: string
  name: string
  sortOrder: number
  moveToLibrary: number | null
  createdAt: number
  count?: number
}

export interface Document {
  id: string
  filePath: string
  originalFolderPath: string
  fileName: string
  fileSize: number | null
  fileHash: string | null
  title: string | null
  authors: string | null
  year: string | null
  venue: string | null
  volume: string | null
  abstract: string | null
  keywords: string | null
  url: string | null
  doi: string | null
  note: string | null
  starred: number
  addedAt: number
  lastReadAt: number | null
  updatedAt: number
  metadataSource: MetadataSource | null
  metadataStatus: MetadataStatus
  metadataAttempts: number
  editedFields: EditableField[]
  remoteValues: RemoteValues | null
  fileMissing: number
  categories?: Category[]
}

export interface WatchFolder {
  id: string
  path: string
  enabled: number
  addedAt: number
}

export type DocumentPatch = Partial<Pick<Document, EditableField>>

export type SearchResult = Document[]

export type ColumnId = 'title' | 'authors' | 'year' | 'venue' | 'addedAt' | 'filePath'

export interface ListColumn {
  id: ColumnId
  visible: boolean
  width: number
  order: number
}

export interface ListColumnState {
  columns: ListColumn[]
  sort: { field: SortField; dir: 'asc' | 'desc' }
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export interface BootstrapData {
  language: 'zh' | 'en'
  windowBounds: WindowBounds | null
  listColumnState: ListColumnState | null
  sidebarCollapsed: boolean
  firstRun: boolean
  libraryFolderPath: string
}

export interface ImportProgress {
  current: number
  total: number
  message?: string
}

export type EventChannel = 'document:updated' | 'import:progress' | 'import:toast' | 'menu:export-bibtex'

export interface DocumentEvents {
  onDocumentUpdated(cb: (doc: Document) => void): void
  onImportProgress(cb: (payload: ImportProgress) => void): void
  onImportToast(cb: (message: string) => void): void
  onMenuExportBibtex(cb: () => void): void
  off(channel: EventChannel, cb: unknown): void
}

export interface ReforaApi {
  getBootstrap(): Promise<BootstrapData>
  documents: {
    list(filter: ListFilter): Promise<Document[]>
    search(q: string): Promise<SearchResult>
    get(id: string): Promise<Document | null>
    update(id: string, patch: DocumentPatch): Promise<Document>
    setStarred(id: string, value: boolean): Promise<void>
    delete(id: string): Promise<void>
    bulkDelete(ids: string[]): Promise<void>
    bulkCategorize(ids: string[], catId: string): Promise<void>
    bulkRefreshMetadata(ids: string[]): Promise<void>
    openPdf(id: string): Promise<Document>
    openInFinder(id: string): Promise<void>
    refreshMetadata(id: string): Promise<Document>
    relocateFile(id: string, newPath: string): Promise<Document>
    restoreFile(id: string): Promise<Document>
  }
  import: {
    addFiles(paths: string[]): Promise<string[]>
    addFolder(dir: string): Promise<string[]>
    fromJson(file: string): Promise<number>
  }
  categories: {
    list(): Promise<Category[]>
    create(name: string, moveToLibrary?: number): Promise<Category>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
    setMoveToLibrary(id: string, value: number | null): Promise<void>
    assign(docId: string, catId: string): Promise<void>
    unassign(docId: string, catId: string): Promise<void>
  }
  watch: {
    list(): Promise<WatchFolder[]>
    add(path: string): Promise<WatchFolder>
    remove(id: string): Promise<void>
    toggle(id: string, enabled: boolean): Promise<void>
  }
  settings: {
    get<T>(key: string, defaultValue: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  dialog: {
    openDirectory(): Promise<string | null>
  }
  getPathForFile(file: unknown): string
  export: {
    toJson(): Promise<string>
    toBibtex(ids: string[]): Promise<string>
  }
  events: DocumentEvents
}
