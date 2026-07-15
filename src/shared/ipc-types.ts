import { IpcChannel } from './ipc-channels'

export interface IpcError {
  code: string
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: IpcError }

export function errorMessage(e: unknown, fallback = 'Unknown error'): string {
  if (e instanceof Error) return e.message || fallback
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message
    if (typeof msg === 'string' && msg.length > 0) return msg
  }
  if (typeof e === 'string' && e.length > 0) return e
  return fallback
}

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
  | 'issue'
  | 'pages'
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
  issue: string | null
  pages: string | null
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
  libraryFolderPath: string | null
}

export interface ImportProgress {
  current: number
  total: number
  message?: string
}

export interface LibrarySwitchResult {
  libraryFolderPath: string
  dbExisted: boolean
  scanned: number
  imported: number
  skipped: number
  errors: Array<{ path: string; message: string }>
}

export interface BibImportResult {
  added: number
  skipped: number
  errors: Array<{ key: string; message: string }>
}

export type IdentifierType = 'doi' | 'arxiv' | 'isbn' | 'url'

export interface IdentifierImportResult {
  added: string[]
  message?: string
}

export type WorkspaceItemKind = 'document' | 'report'

export interface Workspace {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export interface WorkspaceItem {
  id: string
  workspaceId: string
  kind: WorkspaceItemKind
  docId: string | null
  reportId: string | null
  sortOrder: number
  addedAt: number
}

export type ModelVariantFormat = 'dash' | 'colon' | 'none'

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  model: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
  hasKey: boolean
  temperature: number | null
  maxTokens: number | null
  createdAt: number
}

export interface AiProviderInput {
  name: string
  baseUrl: string
  model: string
  baseModel?: string
  variant?: string
  variantFormat?: ModelVariantFormat
  apiKey?: string
  temperature?: number | null
  maxTokens?: number | null
}

export interface AiProviderPatch {
  name?: string
  baseUrl?: string
  model?: string
  baseModel?: string
  variant?: string
  variantFormat?: ModelVariantFormat
  apiKey?: string
  temperature?: number | null
  maxTokens?: number | null
}

export interface ProviderModelInfo {
  id: string
  providerName?: string
  supportsVariants: boolean
}

export interface ListModelsRequest {
  providerId?: string
  baseUrl?: string
  apiKey?: string
}

export interface ListModelsResult {
  ok: boolean
  models: ProviderModelInfo[]
  error?: string
}

export interface AiSummaryContent {
  core: string
  keyPoints: string[]
  methods?: string
  contribution?: string
}

export interface AiSummary {
  docId: string
  model: string | null
  content: AiSummaryContent | null
  createdAt: number
  updatedAt: number
}

export interface AiReport {
  id: string
  workspaceId: string
  title: string
  contentMd: string
  sourceDocIds: string[]
  model: string | null
  createdAt: number
}

export interface ChatThread {
  id: string
  workspaceId: string
  providerId: string
  createdAt: number
  title: string | null
}

export interface ChatAttachment {
  type: 'document'
  docId: string
}

export interface ChatMessage {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: number
}

export interface ChatSendRequest {
  workspaceId: string
  threadId?: string
  text: string
  providerId: string
  model?: string
  features?: {
    deepThinking?: boolean
  }
  attachments?: ChatAttachment[]
}

export type AgentTraceStepKind = 'llm' | 'tool' | 'reasoning' | 'message' | 'run'
export type AgentTraceStepStatus = 'running' | 'done' | 'error'

export interface AgentTraceStep {
  id: string
  threadId: string
  runId: string
  kind: AgentTraceStepKind
  name: string | null
  input: string | null
  output: string | null
  status: AgentTraceStepStatus
  startedAt: number
  endedAt: number | null
  seq: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface ChatTokenEvent {
  threadId: string
  token: string
  runId?: string
  stepId?: string
}

export interface ChatReasoningEvent {
  threadId: string
  token: string
  runId?: string
  stepId?: string
}

export interface ChatDoneEvent {
  threadId: string
  finalText: string
  runId?: string
}

export interface ChatErrorEvent {
  threadId: string
  message: string
  runId?: string
}

export interface ChatTraceEvent {
  threadId: string
  runId: string
  step: AgentTraceStep
}

export interface ChatTitleUpdatedEvent {
  threadId: string
  title: string
}

export interface SummaryErrorEvent {
  docId: string
  message: string
}

export interface WorkspaceItemsChangedEvent {
  workspaceId: string
  reason: 'agent_add_docs' | 'user' | 'other'
  docIds?: string[]
}

export type EventChannelKey = keyof typeof IpcChannel & `Event${string}`
export type EventChannel = (typeof IpcChannel)[EventChannelKey]

export interface DocumentEvents {
  onDocumentUpdated(cb: (doc: Document) => void): void
  onWindowFocusChanged(cb: (focused: boolean) => void): void
  onImportProgress(cb: (payload: ImportProgress) => void): void
  onImportToast(cb: (message: string) => void): void
  onMenuExportBibtex(cb: () => void): void
  onMenuImportZotero(cb: () => void): void
  onMenuImportMendeley(cb: () => void): void
  onMenuImportIdentifier(cb: () => void): void
  onLibraryScanning(cb: (payload: ImportProgress) => void): void
  onLibrarySwitched(cb: (payload: LibrarySwitchResult) => void): void
  onAiSummaryUpdated(cb: (docId: string) => void): void
  onAiSummaryError(cb: (payload: SummaryErrorEvent) => void): void
  onAiChatToken(cb: (payload: ChatTokenEvent) => void): void
  onAiChatReasoning(cb: (payload: ChatReasoningEvent) => void): void
  onAiChatDone(cb: (payload: ChatDoneEvent) => void): void
  onAiChatError(cb: (payload: ChatErrorEvent) => void): void
  onAiChatTrace(cb: (payload: ChatTraceEvent) => void): void
  onAiChatTitleUpdated(cb: (payload: ChatTitleUpdatedEvent) => void): void
  onAiReportCreated(cb: (report: AiReport) => void): void
  onWorkspaceItemsChanged(cb: (payload: WorkspaceItemsChangedEvent) => void): void
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
    countPendingMetadata(): Promise<number>
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
    fromZotero(): Promise<BibImportResult>
    fromMendeley(): Promise<BibImportResult>
    fromIdentifier(identifier: string): Promise<IdentifierImportResult>
  }
  categories: {
    list(): Promise<Category[]>
    create(name: string): Promise<Category>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
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
  library: {
    switch(path: string): Promise<LibrarySwitchResult>
  }
  getPathForFile(file: unknown): string
  export: {
    toJson(): Promise<string>
    toBibtex(ids: string[]): Promise<string>
    toBibtexString(ids: string[]): Promise<string>
  }
  workspaces: {
    list(): Promise<Workspace[]>
    create(name: string): Promise<Workspace>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  workspaceItems: {
    list(workspaceId: string): Promise<WorkspaceItem[]>
    add(workspaceId: string, kind: WorkspaceItemKind, ids: string[]): Promise<WorkspaceItem[]>
    remove(itemId: string): Promise<void>
    reorder(workspaceId: string, orderedIds: string[]): Promise<void>
  }
  aiProviders: {
    list(): Promise<AiProvider[]>
    create(input: AiProviderInput): Promise<AiProvider>
    update(id: string, patch: AiProviderPatch): Promise<AiProvider>
    delete(id: string): Promise<void>
    test(id: string): Promise<{ ok: boolean; models?: string[] }>
    listModels(req: ListModelsRequest): Promise<ListModelsResult>
  }
  ai: {
    docTextGet(docId: string): Promise<string>
    summarize(docId: string): Promise<void>
    summaryGet(docId: string): Promise<AiSummary | null>
    chatSend(req: ChatSendRequest): Promise<{ threadId: string }>
    chatHistory(threadId: string): Promise<ChatMessage[]>
    chatThreads(workspaceId: string): Promise<ChatThread[]>
    chatTraces(threadId: string): Promise<AgentTraceStep[]>
    chatCancel(threadId: string): Promise<void>
    chatDeleteThread(threadId: string): Promise<void>
    renameThread(threadId: string, title: string): Promise<void>
  }
  reports: {
    list(workspaceId: string): Promise<AiReport[]>
    update(id: string, patch: { title?: string; contentMd?: string }): Promise<AiReport>
    delete(id: string): Promise<void>
  }
  events: DocumentEvents
}
