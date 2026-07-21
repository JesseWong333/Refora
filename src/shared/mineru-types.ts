export const MINERU_VERSION = '3.4.4'
export const MINERU_WORKER_PROTOCOL_VERSION = 1
export const OCR_RESULT_SCHEMA_VERSION = 1

export type MineruEngineState =
  | 'notInstalled'
  | 'installing'
  | 'installed'
  | 'unavailable'
  | 'invalid'

export type MineruInstallStage =
  | 'preparing'
  | 'installingTools'
  | 'installingPython'
  | 'installingMineru'
  | 'downloadingModels'
  | 'healthCheck'
  | 'finalizing'
  | 'completed'

export interface MineruInstallProgress {
  installId: string
  startedAt: number
  stage: MineruInstallStage
  currentArtifact: string | null
  bytesReceived: number
  bytesTotal: number | null
  percent: number | null
  cancellable: boolean
  message: string
}

export interface MineruEngineStatus {
  state: MineruEngineState
  installRoot: string
  installPath: string | null
  version: string | null
  architecture: string
  pythonPath: string | null
  modelConfigPath: string | null
  installedAt: number | null
  diskBytes: number | null
  error: string | null
  progress: MineruInstallProgress | null
}

export type OcrProfile = 'compatible' | 'balanced' | 'quality'
export type OcrJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type OcrJobStage =
  | 'queued'
  | 'startingWorker'
  | 'loadingModels'
  | 'parsing'
  | 'writingResults'
  | 'validating'
  | 'completed'

export interface OcrJob {
  id: string
  documentId: string
  resultKey: string
  sourceHash: string
  profile: OcrProfile
  status: OcrJobStatus
  stage: OcrJobStage
  progress: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface OcrResult {
  id: string
  documentId: string
  resultKey: string
  sourceHash: string
  mineruVersion: string
  modelRevision: string
  profile: OcrProfile
  optionsHash: string
  schemaVersion: number
  relativeRoot: string
  markdownRelativePath: string
  blocksRelativePath: string
  manifestRelativePath: string
  createdAt: number
  stale: boolean
}

export interface OcrDocumentState {
  engine: MineruEngineStatus
  activeJob: OcrJob | null
  result: OcrResult | null
}

export interface OcrProgressEvent {
  job: OcrJob
}

export interface OcrCompletedEvent {
  jobId: string
  documentId: string
  result: OcrResult
}

export interface OcrErrorEvent {
  jobId: string
  documentId: string
  code: string
  message: string
}
