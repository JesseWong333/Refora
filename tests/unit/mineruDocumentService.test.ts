import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../../src/main/db/migrations'
import { seedDefaultSettings } from '../../src/main/db/settings-seed'
import { createRepositories } from '../../src/main/db/repositories'
import { createMineruDocumentService } from '../../src/main/services/mineruDocumentService'
import type { MineruEngineManager } from '../../src/main/services/mineruEngineManager'
import type { MineruWorkerProcess } from '../../src/main/services/mineruWorkerProcess'
import type { MineruEngineStatus, OcrCompletedEvent } from '../../src/shared/mineru-types'

const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite')
const directories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'refora-mineru-document-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

function repositories(library: string, pdfPath: string) {
  const raw = new DatabaseSync(':memory:')
  raw.exec('PRAGMA foreign_keys = ON')
  const db = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => raw.prepare(sql),
    getUserVersion: () => {
      const row = raw.prepare('PRAGMA user_version').get() as { user_version: number }
      return row.user_version
    },
    setUserVersion: (version: number) => raw.exec(`PRAGMA user_version = ${version}`),
    hasColumn: (table: string, column: string) =>
      raw.prepare('SELECT 1 FROM pragma_table_info(?) WHERE name = ?').get(table, column) !== undefined,
    hasObject: (type: 'table' | 'index', name: string) =>
      raw.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !== undefined
  }
  runMigrations(db)
  seedDefaultSettings(db, 'en')
  const repos = createRepositories(db)
  repos.settings.set('libraryFolderPath', library)
  raw.prepare(
    `INSERT INTO documents (id, filePath, originalFolderPath, fileName, fileHash, addedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('doc-1', pdfPath, library, 'paper.pdf', 'source-hash', 1, 1)
  return repos
}

const engineStatus: MineruEngineStatus = {
  state: 'installed',
  installRoot: '/models',
  installPath: '/models/Refora/MinerU/3.4.4/darwin-arm64',
  version: '3.4.4',
  architecture: 'arm64',
  pythonPath: '/models/python',
  modelConfigPath: '/models/mineru.json',
  installedAt: 1,
  diskBytes: null,
  error: null,
  progress: null
}

describe('MinerU document service', () => {
  it('runs balanced OCR and returns its Markdown for Agent reading', async () => {
    const library = temporaryDirectory()
    const pdfPath = join(library, 'paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.7\n')
    const repos = repositories(library, pdfPath)
    const engineManager = {
      getStatus: vi.fn(async () => engineStatus),
      getRuntime: vi.fn(async () => ({
        installPath: engineStatus.installPath as string,
        pythonPath: engineStatus.pythonPath as string,
        modelConfigPath: engineStatus.modelConfigPath as string,
        modelRevision: 'models-1',
        environment: {}
      }))
    } as unknown as MineruEngineManager
    const worker = {
      parse: vi.fn(async (_input: string, output: string) => {
        await mkdir(output, { recursive: true })
        await Promise.all([
          writeFile(join(output, 'document.md'), '# Balanced OCR'),
          writeFile(join(output, 'blocks.jsonl'), '{"type":"text"}\n'),
          writeFile(join(output, 'middle.json'), '{"pdf_info":[]}')
        ])
        return {
          markdown: 'document.md',
          blocks: 'blocks.jsonl',
          middle: 'middle.json',
          assets: null,
          pageCount: 1,
          blockCount: 1
        }
      }),
      cancel: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn()
    } as unknown as MineruWorkerProcess
    const service = createMineruDocumentService({
      repos,
      engineManager,
      worker,
      getLibraryFolder: () => library,
      emitProgress: vi.fn(),
      emitCompleted: vi.fn(),
      emitError: vi.fn()
    })

    expect(await service.readCachedForAgent('doc-1')).toBeNull()
    expect(worker.parse).not.toHaveBeenCalled()

    const first = await service.prepareForAgent('doc-1')
    const cached = await service.readCachedForAgent('doc-1')
    const second = await service.prepareForAgent('doc-1')

    expect(first.markdown).toBe('# Balanced OCR')
    expect(first.result.profile).toBe('balanced')
    expect(cached?.result.resultKey).toBe(first.result.resultKey)
    expect(second.result.resultKey).toBe(first.result.resultKey)
    expect(worker.parse).toHaveBeenCalledOnce()
    expect(worker.parse).toHaveBeenCalledWith(
      pdfPath,
      expect.stringContaining('.staging'),
      'balanced',
      expect.any(Function)
    )
  })

  it('publishes normalized results under the Library OCR derived path', async () => {
    const library = temporaryDirectory()
    const pdfPath = join(library, 'paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.7\n')
    const repos = repositories(library, pdfPath)
    const engineManager = {
      getStatus: vi.fn(async () => engineStatus),
      getRuntime: vi.fn(async () => ({
        installPath: engineStatus.installPath as string,
        pythonPath: engineStatus.pythonPath as string,
        modelConfigPath: engineStatus.modelConfigPath as string,
        modelRevision: 'models-1',
        environment: {}
      }))
    } as unknown as MineruEngineManager
    const worker = {
      parse: vi.fn(async (_input: string, output: string) => {
        await mkdir(output, { recursive: true })
        await Promise.all([
          writeFile(join(output, 'document.md'), '# Parsed\n\n![Figure](assets/figure.png)'),
          writeFile(join(output, 'blocks.jsonl'), '{"type":"text"}\n'),
          writeFile(join(output, 'middle.json'), '{"pdf_info":[]}'),
          mkdir(join(output, 'assets'), { recursive: true }).then(() =>
            writeFile(join(output, 'assets', 'figure.png'), 'image'))
        ])
        return {
          markdown: 'document.md',
          blocks: 'blocks.jsonl',
          middle: 'middle.json',
          assets: 'assets',
          pageCount: 1,
          blockCount: 1
        }
      }),
      cancel: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn()
    } as unknown as MineruWorkerProcess
    let complete: (event: OcrCompletedEvent) => void = () => undefined
    const completed = new Promise<OcrCompletedEvent>((resolvePromise) => {
      complete = resolvePromise
    })
    const service = createMineruDocumentService({
      repos,
      engineManager,
      worker,
      getLibraryFolder: () => library,
      emitProgress: vi.fn(),
      emitCompleted: complete,
      emitError: vi.fn()
    })

    await service.initialize()
    const job = await service.start('doc-1', 'balanced')
    const event = await completed
    const expectedRoot = join(library, '.refora', 'derived', 'OCR', 'doc-1', job.resultKey)

    expect(event.result.relativeRoot).toBe(
      join('.refora', 'derived', 'OCR', 'doc-1', job.resultKey)
    )
    expect(await readFile(join(expectedRoot, 'document.md'), 'utf8')).toContain('# Parsed')
    expect(JSON.parse(await readFile(join(expectedRoot, 'manifest.json'), 'utf8'))).toMatchObject({
      documentId: 'doc-1',
      resultKey: job.resultKey,
      mineruVersion: '3.4.4',
      modelRevision: 'models-1',
      profile: 'balanced'
    })
    const cached = await service.readCachedForAgent('doc-1')
    expect(cached?.result.profile).toBe('balanced')
    expect(cached?.markdown).toContain('# Parsed')
    expect(repos.documentOcr.getJob(job.id)?.status).toBe('succeeded')
    expect(worker.parse).toHaveBeenCalledWith(pdfPath, expect.stringContaining('.staging'), 'balanced', expect.any(Function))
  })

  it('rejects a second start while the first start is still resolving', async () => {
    const library = temporaryDirectory()
    const pdfPath = join(library, 'paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.7\n')
    const repos = repositories(library, pdfPath)
    let releaseRuntime: (runtime: Awaited<ReturnType<MineruEngineManager['getRuntime']>>) => void = () => undefined
    const runtime = new Promise<Awaited<ReturnType<MineruEngineManager['getRuntime']>>>((resolvePromise) => {
      releaseRuntime = resolvePromise
    })
    const engineManager = {
      getRuntime: vi.fn(() => runtime)
    } as unknown as MineruEngineManager
    let releaseParse: () => void = () => undefined
    const parseGate = new Promise<void>((resolvePromise) => {
      releaseParse = resolvePromise
    })
    const worker = {
      parse: vi.fn(async (_input: string, output: string) => {
        await parseGate
        await mkdir(output, { recursive: true })
        await Promise.all([
          writeFile(join(output, 'document.md'), '# Parsed'),
          writeFile(join(output, 'blocks.jsonl'), '{"type":"text"}\n'),
          writeFile(join(output, 'middle.json'), '{"pdf_info":[]}')
        ])
        return {
          markdown: 'document.md',
          blocks: 'blocks.jsonl',
          middle: 'middle.json',
          assets: null,
          pageCount: 1,
          blockCount: 1
        }
      }),
      cancel: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn()
    } as unknown as MineruWorkerProcess
    const service = createMineruDocumentService({
      repos,
      engineManager,
      worker,
      getLibraryFolder: () => library,
      emitProgress: vi.fn(),
      emitCompleted: vi.fn(),
      emitError: vi.fn()
    })

    const first = service.start('doc-1', 'balanced')
    await Promise.resolve()
    await expect(service.start('doc-1', 'balanced')).rejects.toMatchObject({ code: 'busy' })
    releaseRuntime({
      installPath: '/models/Refora/MinerU/3.4.4/darwin-arm64',
      pythonPath: '/models/python',
      modelConfigPath: '/models/mineru.json',
      modelRevision: 'models-1',
      environment: {}
    })
    await expect(first).resolves.toMatchObject({ status: 'queued' })
    await vi.waitFor(() => expect(worker.parse).toHaveBeenCalledOnce())
    releaseParse()
    await vi.waitFor(() => {
      expect(repos.documentOcr.getAnyActiveJob()).toBeNull()
    })
    service.destroy()
  })

  it('waits for validation cancellation before deleting document-derived data', async () => {
    const library = temporaryDirectory()
    const pdfPath = join(library, 'paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.7\n')
    const repos = repositories(library, pdfPath)
    const engineManager = {
      getRuntime: vi.fn(async () => ({
        installPath: engineStatus.installPath as string,
        pythonPath: engineStatus.pythonPath as string,
        modelConfigPath: engineStatus.modelConfigPath as string,
        modelRevision: 'models-1',
        environment: {}
      }))
    } as unknown as MineruEngineManager
    const worker = {
      parse: vi.fn(async (_input: string, output: string) => {
        await mkdir(output, { recursive: true })
        await Promise.all([
          writeFile(join(output, 'document.md'), '# Parsed'),
          writeFile(join(output, 'blocks.jsonl'), '{"type":"text"}\n'),
          writeFile(join(output, 'middle.json'), '{"pdf_info":[]}')
        ])
        return {
          markdown: 'document.md',
          blocks: 'blocks.jsonl',
          middle: 'middle.json',
          assets: null,
          pageCount: 1,
          blockCount: 1
        }
      }),
      cancel: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn()
    } as unknown as MineruWorkerProcess
    let markValidating: () => void = () => undefined
    const validating = new Promise<void>((resolvePromise) => {
      markValidating = resolvePromise
    })
    const service = createMineruDocumentService({
      repos,
      engineManager,
      worker,
      getLibraryFolder: () => library,
      emitProgress: (event) => {
        if (event.job.stage === 'validating') markValidating()
      },
      emitCompleted: vi.fn(),
      emitError: vi.fn()
    })

    const job = await service.start('doc-1', 'balanced')
    await validating
    await service.prepareDocumentDelete('doc-1')

    expect(repos.documentOcr.getJob(job.id)?.status).toBe('cancelled')
    expect(repos.documentOcr.getResult('doc-1')).toBeNull()
    await expect(access(join(library, '.refora', 'derived', 'OCR', 'doc-1'))).rejects.toThrow()
  })

  it('restores the previous result when replacement publication fails', async () => {
    const library = temporaryDirectory()
    const pdfPath = join(library, 'paper.pdf')
    writeFileSync(pdfPath, '%PDF-1.7\n')
    const repos = repositories(library, pdfPath)
    const engineManager = {
      getRuntime: vi.fn(async () => ({
        installPath: engineStatus.installPath as string,
        pythonPath: engineStatus.pythonPath as string,
        modelConfigPath: engineStatus.modelConfigPath as string,
        modelRevision: 'models-1',
        environment: {}
      }))
    } as unknown as MineruEngineManager
    let parseCount = 0
    const worker = {
      parse: vi.fn(async (_input: string, output: string) => {
        parseCount += 1
        await mkdir(output, { recursive: true })
        await Promise.all([
          writeFile(join(output, 'document.md'), `# Parsed ${parseCount}`),
          writeFile(join(output, 'blocks.jsonl'), '{"type":"text"}\n'),
          writeFile(join(output, 'middle.json'), '{"pdf_info":[]}')
        ])
        return {
          markdown: 'document.md',
          blocks: 'blocks.jsonl',
          middle: 'middle.json',
          assets: null,
          pageCount: 1,
          blockCount: 1
        }
      }),
      cancel: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn()
    } as unknown as MineruWorkerProcess
    let failNextPublishRename = false
    const service = createMineruDocumentService({
      repos,
      engineManager,
      worker,
      getLibraryFolder: () => library,
      emitProgress: vi.fn(),
      emitCompleted: vi.fn(),
      emitError: vi.fn(),
      renamePath: async (source, destination) => {
        if (failNextPublishRename && String(source).includes('.staging')) {
          failNextPublishRename = false
          throw new Error('simulated publication failure')
        }
        await rename(source, destination)
      }
    })

    const first = await service.start('doc-1', 'balanced')
    await vi.waitFor(() => expect(repos.documentOcr.getJob(first.id)?.status).toBe('succeeded'))
    const resultRoot = join(library, '.refora', 'derived', 'OCR', 'doc-1', first.resultKey)
    expect(await readFile(join(resultRoot, 'document.md'), 'utf8')).toBe('# Parsed 1')

    failNextPublishRename = true
    const second = await service.start('doc-1', 'balanced')
    await vi.waitFor(() => expect(repos.documentOcr.getJob(second.id)?.status).toBe('failed'))

    expect(await readFile(join(resultRoot, 'document.md'), 'utf8')).toBe('# Parsed 1')
    expect(repos.documentOcr.getResult('doc-1')?.resultKey).toBe(first.resultKey)
  })
})
