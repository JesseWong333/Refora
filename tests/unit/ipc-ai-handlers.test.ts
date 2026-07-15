import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
import type { AiProvider, AiProviderInput, AiProviderPatch, ListModelsRequest, ChatSendRequest, ChatMessage, ChatThread, AgentTraceStep, AiReport, AiSummary } from '../../src/shared/ipc-types'
import type { Repositories } from '../../src/main/db/repositories'
import type { RuntimeRef, IpcHandlerMap } from '../../src/main/ipc/handlers'
import { IpcChannel } from '../../src/shared/ipc-channels'
import { RepoError } from '../../src/main/db/repositories/errors'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'
import { createIpcHandlers } from '../../src/main/ipc/handlers'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn(), trashItem: vi.fn() },
  session: { defaultSession: { setProxy: vi.fn().mockResolvedValue(undefined) } },
  app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
  BrowserWindow: vi.fn(),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString())
  },
  net: { fetch: vi.fn() },
  utilityProcess: { fork: vi.fn() }
}))

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'debug' }, console: { level: 'debug' } },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')

function createTestDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = OFF')
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    getUserVersion: () => {
      const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      return row.user_version
    },
    setUserVersion: (version: number) => {
      raw.exec(`PRAGMA user_version = ${version}`)
    }
  }
  runMigrations(db)
  seedDefaultSettings(db, 'en')
  return db
}

type AnyResult = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } }

let db: ReturnType<typeof createTestDb>
let repos: Repositories
let handlers: IpcHandlerMap
let runtime: RuntimeRef

const mockProvider: AiProvider = {
  id: 'p1',
  name: 'Test Provider',
  baseUrl: 'https://api.test.com/v1',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'dash',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1700000000000
}

function makeMockAiProvidersService() {
  return {
    list: vi.fn(() => [mockProvider]),
    create: vi.fn((input: AiProviderInput) => ({ ...mockProvider, ...input })),
    update: vi.fn((id: string, patch: AiProviderPatch) => ({ ...mockProvider, id, ...patch })),
    remove: vi.fn(),
    test: vi.fn(async () => ({ ok: true, models: ['gpt-4o'] })),
    listModels: vi.fn(async () => ({ ok: true, models: [] })),
    getProvider: vi.fn(() => mockProvider),
    getDecryptedKey: vi.fn(() => 'decrypted-key')
  }
}

function makeMockPdfTextService() {
  return {
    getOrExtract: vi.fn(async () => 'extracted text'),
    destroy: vi.fn()
  }
}

function makeMockAiSummaryService() {
  return {
    summarize: vi.fn(),
    destroy: vi.fn()
  }
}

function makeMockAiAgentService() {
  return {
    run: vi.fn(async () => undefined),
    cancel: vi.fn(),
    destroy: vi.fn()
  }
}

function callSync(channel: string, ...args: unknown[]): AnyResult {
  const h = handlers as Record<string, (...a: unknown[]) => unknown>
  return h[channel](...args) as AnyResult
}

async function callAsync(channel: string, ...args: unknown[]): Promise<AnyResult> {
  const h = handlers as Record<string, (...a: unknown[]) => unknown>
  const result = h[channel](...args)
  return (result instanceof Promise ? await result : result) as AnyResult
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createTestDb()
  repos = createRepositories(db)

  const aiProvidersService = makeMockAiProvidersService()
  const pdfTextService = makeMockPdfTextService()
  const aiSummaryService = makeMockAiSummaryService()
  const aiAgentService = makeMockAiAgentService()

  runtime = {
    repos,
    aiProvidersService,
    pdfTextService,
    aiSummaryService,
    aiAgentService
  }

  handlers = createIpcHandlers({
    getWin: () => null,
    getRuntime: () => runtime
  })
})

describe('IPC AI Handlers', () => {
  describe('AiProvidersList', () => {
    it('returns provider list via service.list()', () => {
      const result = callSync(IpcChannel.AiProvidersList)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([mockProvider])
      }
      expect(runtime.aiProvidersService!.list).toHaveBeenCalledTimes(1)
    })
  })

  describe('AiProvidersCreate', () => {
    it('creates provider via service.create()', async () => {
      const input: AiProviderInput = {
        name: 'New',
        baseUrl: 'https://api.new.com/v1',
        model: 'gpt-4o',
        apiKey: 'key'
      }
      const result = await callAsync(IpcChannel.AiProvidersCreate, input)
      expect(result.ok).toBe(true)
      expect(runtime.aiProvidersService!.create).toHaveBeenCalledWith(input)
    })
  })

  describe('AiProvidersUpdate', () => {
    it('updates provider via service.update()', async () => {
      const patch: AiProviderPatch = { name: 'Updated' }
      const result = await callAsync(IpcChannel.AiProvidersUpdate, 'p1', patch)
      expect(result.ok).toBe(true)
      expect(runtime.aiProvidersService!.update).toHaveBeenCalledWith('p1', patch)
    })
  })

  describe('AiProvidersDelete', () => {
    it('deletes provider via service.remove()', () => {
      const result = callSync(IpcChannel.AiProvidersDelete, 'p1')
      expect(result.ok).toBe(true)
      expect(runtime.aiProvidersService!.remove).toHaveBeenCalledWith('p1')
    })
  })

  describe('AiProvidersTest', () => {
    it('calls service.test()', async () => {
      const result = await callAsync(IpcChannel.AiProvidersTest, 'p1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ ok: true, models: ['gpt-4o'] })
      }
      expect(runtime.aiProvidersService!.test).toHaveBeenCalledWith('p1')
    })
  })

  describe('AiProvidersListModels', () => {
    it('calls service.listModels()', async () => {
      const req: ListModelsRequest = { providerId: 'p1' }
      const result = await callAsync(IpcChannel.AiProvidersListModels, req)
      expect(result.ok).toBe(true)
      expect(runtime.aiProvidersService!.listModels).toHaveBeenCalledWith(req)
    })
  })

  describe('AiDocTextGet', () => {
    it('calls pdfTextService.getOrExtract()', async () => {
      const result = await callAsync(IpcChannel.AiDocTextGet, 'doc-1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBe('extracted text')
      }
      expect(runtime.pdfTextService!.getOrExtract).toHaveBeenCalledWith('doc-1')
    })
  })

  describe('AiSummarize', () => {
    it('calls aiSummaryService.summarize()', () => {
      const result = callSync(IpcChannel.AiSummarize, 'doc-1')
      expect(result.ok).toBe(true)
      expect(runtime.aiSummaryService!.summarize).toHaveBeenCalledWith('doc-1')
    })
  })

  describe('AiSummaryGet', () => {
    it('returns summary or null from repos', () => {
      const result = callSync(IpcChannel.AiSummaryGet, 'doc-1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeNull()
      }
    })

    it('returns stored summary when exists', () => {
      repos.aiSummaries.setSummary('doc-1', 'gpt-4o', { core: 'Test', keyPoints: [] })
      const result = callSync(IpcChannel.AiSummaryGet, 'doc-1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        const summary = result.data as AiSummary
        expect(summary.docId).toBe('doc-1')
        expect(summary.model).toBe('gpt-4o')
      }
    })
  })

  describe('AiChatSend', () => {
    function seedProvider(withKey = true): string {
      const provider = repos.aiProviders.create({
        presetId: 'openai',
        name: 'Test',
        baseUrl: 'http://x',
        apiProtocol: 'openai-compatible',
        reasoningControl: 'openai',
        reasoningEffort: 'medium',
        model: 'gpt-4o',
        baseModel: 'gpt-4o',
        variant: '',
        variantFormat: 'dash',
        apiKeyEnc: withKey ? Buffer.from('key') : null,
        temperature: null,
        maxTokens: null
      })
      return provider.id
    }

    it('creates new thread when no threadId provided', async () => {
      const pid = seedProvider()
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: pid
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const data = result.data as { threadId: string }
        const thread = repos.chat.getThread(data.threadId)
        expect(thread).not.toBeNull()
        expect(thread!.workspaceId).toBe('ws-1')
        expect(thread!.providerId).toBe(pid)
      }
    })

    it('reuses existing thread when threadId provided and valid', async () => {
      const pid = seedProvider()
      const thread = repos.chat.createThread('ws-1', pid)
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        threadId: thread.id,
        text: 'hello',
        providerId: pid
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual({ threadId: thread.id })
      }
    })

    it('returns error when thread belongs to different workspace', async () => {
      const pid = seedProvider()
      const thread = repos.chat.createThread('ws-1', pid)
      const req: ChatSendRequest = {
        workspaceId: 'ws-2',
        threadId: thread.id,
        text: 'hello',
        providerId: pid
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not_found')
      }
    })

    it('returns error when no provider configured (no providerId, no activeProviderId setting)', async () => {
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: ''
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('no_provider')
      }
    })

    it('uses activeProviderId setting when no providerId in request', async () => {
      const pid = seedProvider()
      repos.settings.set('activeProviderId', pid)
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: ''
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(true)
    })

    it('returns error when provider has no API key', async () => {
      const pid = seedProvider(false)
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: pid
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('no_api_key')
      }
    })

    it('calls aiAgentService.run() with correct params', async () => {
      const pid = seedProvider()
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: pid
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(true)
      expect(runtime.aiAgentService!.run).toHaveBeenCalledTimes(1)
      const runArg = (runtime.aiAgentService!.run as ReturnType<typeof vi.fn>).mock.calls[0][0] as ChatSendRequest
      expect(runArg.text).toBe('hello')
      expect(runArg.workspaceId).toBe('ws-1')
      expect(runArg.providerId).toBe(pid)
      const runThreadId = (runtime.aiAgentService!.run as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
      expect(runThreadId).toBe((result as { ok: true; data: { threadId: string } }).data.threadId)
    })

    it('accepts only document attachments already present in the workspace', async () => {
      const pid = seedProvider()
      const workspace = repos.workspaces.create('Attachments')
      db.prepare(
        `INSERT INTO documents (id, filePath, originalFolderPath, fileName, addedAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('doc-1', '/abs/doc-1.pdf', '/abs', 'doc-1.pdf', 1, 1)
      repos.workspaceItems.add(workspace.id, 'document', ['doc-1'])
      const thread = repos.chat.createThread(workspace.id, pid)

      const valid = await callAsync(IpcChannel.AiChatSend, {
        workspaceId: workspace.id,
        threadId: thread.id,
        text: 'Use the paper',
        providerId: pid,
        attachments: [{ type: 'document', docId: 'doc-1' }]
      })
      expect(valid.ok).toBe(true)

      const invalid = await callAsync(IpcChannel.AiChatSend, {
        workspaceId: workspace.id,
        threadId: thread.id,
        text: 'Use another paper',
        providerId: pid,
        attachments: [{ type: 'document', docId: 'missing' }]
      })
      expect(invalid).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'invalid_attachment' })
        })
      )
    })

    it('returns error when agent service not ready', async () => {
      runtime.aiAgentService = undefined
      const req: ChatSendRequest = {
        workspaceId: 'ws-1',
        text: 'hello',
        providerId: ''
      }
      const result = await callAsync(IpcChannel.AiChatSend, req)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not_ready')
      }
    })
  })

  describe('AiChatHistory', () => {
    it('returns messages for thread', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.chat.addMessage(thread.id, 'user', 'hello')
      repos.chat.addMessage(thread.id, 'assistant', 'hi')
      const result = callSync(IpcChannel.AiChatHistory, thread.id)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const messages = result.data as ChatMessage[]
        expect(messages).toHaveLength(2)
        expect(messages[0].content).toBe('hello')
        expect(messages[1].content).toBe('hi')
      }
    })

    it('returns empty array for empty threadId', () => {
      const result = callSync(IpcChannel.AiChatHistory, '')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })
  })

  describe('AiChatThreads', () => {
    it('returns threads for workspace', () => {
      repos.chat.createThread('ws-1', 'p1')
      repos.chat.createThread('ws-1', 'p1')
      repos.chat.createThread('ws-2', 'p1')
      const result = callSync(IpcChannel.AiChatThreads, 'ws-1')
      expect(result.ok).toBe(true)
      if (result.ok) {
        const threads = result.data as ChatThread[]
        expect(threads).toHaveLength(2)
        threads.forEach((t) => expect(t.workspaceId).toBe('ws-1'))
      }
    })
  })

  describe('AiChatTraces', () => {
    it('returns traces for thread', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      repos.agentTraces.addStep({
        threadId: thread.id,
        runId: 'r1',
        kind: 'llm',
        status: 'done',
        startedAt: 1000,
        seq: 0
      })
      const result = callSync(IpcChannel.AiChatTraces, thread.id)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const steps = result.data as AgentTraceStep[]
        expect(steps).toHaveLength(1)
        expect(steps[0].kind).toBe('llm')
      }
    })

    it('returns empty array for empty threadId', () => {
      const result = callSync(IpcChannel.AiChatTraces, '')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toEqual([])
      }
    })
  })

  describe('AiChatCancel', () => {
    it('calls aiAgentService.cancel()', () => {
      const result = callSync(IpcChannel.AiChatCancel, 'thread-1')
      expect(result.ok).toBe(true)
      expect(runtime.aiAgentService!.cancel).toHaveBeenCalledWith('thread-1')
    })

    it('returns error when agent service not ready', () => {
      runtime.aiAgentService = undefined
      const result = callSync(IpcChannel.AiChatCancel, 'thread-1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not_ready')
      }
    })
  })

  describe('AiChatDeleteThread', () => {
    it('deletes thread from repos', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const result = callSync(IpcChannel.AiChatDeleteThread, thread.id)
      expect(result.ok).toBe(true)
      expect(repos.chat.getThread(thread.id)).toBeNull()
    })

    it('returns error when thread not found', () => {
      const result = callSync(IpcChannel.AiChatDeleteThread, 'nonexistent')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not_found')
      }
    })
  })

  describe('AiChatRenameThread', () => {
    it('renames an existing thread', () => {
      const thread = repos.chat.createThread('ws-1', 'p1')
      const result = callSync(IpcChannel.AiChatRenameThread, thread.id, 'Renamed')

      expect(result.ok).toBe(true)
      expect(repos.chat.getThread(thread.id)?.title).toBe('Renamed')
    })
  })

  describe('AiReportsList', () => {
    it('returns reports for workspace', () => {
      repos.workspaces.create('WS1')
      const wsList = repos.workspaces.list()
      const wsId = wsList[0].id
      repos.aiReports.create({
        workspaceId: wsId,
        title: 'Report 1',
        contentMd: 'content',
        sourceDocIds: [],
        model: 'gpt-4o'
      })
      const result = callSync(IpcChannel.AiReportsList, wsId)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const reports = result.data as AiReport[]
        expect(reports).toHaveLength(1)
        expect(reports[0].title).toBe('Report 1')
      }
    })
  })

  describe('AiReportsDelete', () => {
    it('deletes report', () => {
      repos.workspaces.create('WS1')
      const wsId = repos.workspaces.list()[0].id
      const report = repos.aiReports.create({
        workspaceId: wsId,
        title: 'To Delete',
        contentMd: 'content',
        sourceDocIds: [],
        model: null
      })
      const result = callSync(IpcChannel.AiReportsDelete, report.id)
      expect(result.ok).toBe(true)
      expect(repos.aiReports.list(wsId)).toHaveLength(0)
    })

    it('returns error when report not found', () => {
      const result = callSync(IpcChannel.AiReportsDelete, 'nonexistent')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('not_found')
      }
    })
  })

  describe('AiReportsUpdate', () => {
    it('updates report title and content', () => {
      const workspace = repos.workspaces.create('Reports')
      const report = repos.aiReports.create({
        workspaceId: workspace.id,
        title: 'Draft',
        contentMd: 'Old',
        sourceDocIds: [],
        model: null
      })

      const result = callSync(IpcChannel.AiReportsUpdate, report.id, {
        title: 'Final',
        contentMd: 'New'
      })
      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          data: expect.objectContaining({ title: 'Final', contentMd: 'New' })
        })
      )
    })
  })

  describe('Result envelope', () => {
    it('success returns { ok: true, data }', () => {
      const result = callSync(IpcChannel.AiProvidersList)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data).toBeDefined()
      }
    })

    it('failure returns { ok: false, error: { code, message } }', () => {
      const result = callSync(IpcChannel.AiChatDeleteThread, 'nonexistent')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBeTypeOf('string')
        expect(result.error.message).toBeTypeOf('string')
      }
    })

    it('handlers that throw internally resolve to { ok: false }', () => {
      ;(runtime.aiProvidersService!.list as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('unexpected error')
      })
      const result = callSync(IpcChannel.AiProvidersList)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error')
        expect(result.error.message).toBe('unexpected error')
      }
    })

    it('RepoError thrown by handler resolves to { ok: false } with matching code', () => {
      ;(runtime.aiProvidersService!.list as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new RepoError('custom_code', 'custom message')
      })
      const result = callSync(IpcChannel.AiProvidersList)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('custom_code')
        expect(result.error.message).toBe('custom message')
      }
    })

    it('async handlers that reject resolve to { ok: false }', async () => {
      ;(runtime.aiProvidersService!.test as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('async fail'))
      const result = await callAsync(IpcChannel.AiProvidersTest, 'p1')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error')
      }
    })
  })
})
