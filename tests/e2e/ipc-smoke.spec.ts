import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import electronExe from 'electron'

const mainScript = path.resolve(__dirname, '..', '..', 'out', 'main', 'index.js')

type ElectronApi = Record<string, unknown> & {
  getBootstrap(): Promise<Record<string, unknown>>
  settings: {
    set(key: string, value: unknown): Promise<void>
    get(key: string, defaultValue: unknown): Promise<unknown>
  }
  import: {
    addFiles(paths: string[]): Promise<string[]>
  }
  documents: {
    update(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  events: {
    onDocumentUpdated(cb: (doc: Record<string, unknown>) => void): void
  }
}

function api(pageEvalWindow: Window & typeof globalThis): ElectronApi {
  return (pageEvalWindow as Window & { api: ElectronApi }).api
}

test.describe('IPC Smoke', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let electronPage: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>
  let libraryFolder: string

  test.beforeAll(async () => {
    libraryFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'refora-e2e-smoke-'))
    electronApp = await electron.launch({
      executablePath: electronExe,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
      },
      args: [mainScript],
    })
    electronPage = await electronApp.firstWindow()
    await electronPage.evaluate(
      async (lib: string) => api(window).settings.set('libraryFolderPath', lib),
      libraryFolder,
    )
  })

  test.afterAll(async () => {
    await electronApp?.close()
    try { fs.rmSync(libraryFolder, { recursive: true, force: true }) } catch { void 0 }
  })

  test('getBootstrap() returns valid shape', async () => {
    const bootstrap = await electronPage.evaluate(() => api(window).getBootstrap())
    expect(bootstrap).toBeDefined()
    expect(typeof bootstrap.language).toBe('string')
    expect(['zh', 'en']).toContain(bootstrap.language)
    expect(typeof bootstrap.sidebarCollapsed).toBe('boolean')
    expect(typeof bootstrap.firstRun).toBe('boolean')
    if (bootstrap.windowBounds !== null) {
      expect(bootstrap.windowBounds).toMatchObject({
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
        isMaximized: expect.any(Boolean),
      })
    }
  })

  test('settings get / set round-trip', async () => {
    await electronPage.evaluate(() => api(window).settings.set('e2e_test_key', 'e2e_test_value'))
    const value = await electronPage.evaluate(() => api(window).settings.get('e2e_test_key', null))
    expect(value).toBe('e2e_test_value')
  })

  test('document:updated event fires on update', async () => {
    const pdfPath = path.resolve(__dirname, '..', 'fixtures', 'valid.pdf')
    const ids = await electronPage.evaluate(
      async (absPath: string) => api(window).import.addFiles([absPath]),
      pdfPath,
    )
    expect(ids.length).toBeGreaterThan(0)
    const docId: string = ids[0]

    const eventDoc = await electronPage.evaluate((id: string) => {
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timeout waiting for document:updated')),
          15000,
        )
        api(window).events.onDocumentUpdated((doc: Record<string, unknown>) => {
          if (doc.id === id) {
            clearTimeout(timeout)
            resolve(doc)
          }
        })
        void api(window).documents.update(id, { title: 'E2E Test Title' })
      })
    }, docId)

    expect(eventDoc.id).toBe(docId)
    expect(eventDoc.title).toBe('E2E Test Title')
  })
})
