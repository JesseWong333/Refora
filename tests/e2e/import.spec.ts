import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import electronExe from 'electron'

const mainScript = path.resolve(__dirname, '..', '..', 'out', 'main', 'index.js')
const fixturesDir = path.resolve(__dirname, '..', 'fixtures')

interface DocumentItem {
  id: string
  filePath: string
  fileName: string
}

test.describe('Import E2E', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let electronPage: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>

  test.beforeAll(async () => {
    electronApp = await electron.launch({
      executablePath: electronExe,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
      },
      args: [mainScript],
    })
    electronPage = await electronApp.firstWindow()
  })

  test.afterAll(async () => {
    await electronApp?.close()
  })

  test('imports a single valid PDF and document appears in list', async () => {
    const validPath = path.resolve(fixturesDir, 'valid.pdf')
    const ids = await electronPage.evaluate(async (p: string) => {
      const w = window as Window & { api: { import: { addFiles(paths: string[]): Promise<string[]> } } }
      return w.api.import.addFiles([p])
    }, validPath)
    expect(ids).toHaveLength(1)

    const docs = await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].filePath).toBe(validPath)
  })

  test('emits import:progress events when importing multiple files', async () => {
    const encryptedPath = path.resolve(fixturesDir, 'encrypted.pdf')
    const corruptedPath = path.resolve(fixturesDir, 'corrupted.pdf')
    const withDoiPath = path.resolve(fixturesDir, 'with-doi.pdf')
    const filePaths = [encryptedPath, corruptedPath, withDoiPath]

    const events = await electronPage.evaluate(async (paths: string[]) => {
      const w = window as Window & {
        api: {
          import: { addFiles(ps: string[]): Promise<string[]> }
          events: {
            onImportProgress(cb: (p: { current: number; total: number; message?: string }) => void): void
          }
        }
      }
      return new Promise<Array<{ current: number; total: number; message?: string }>>((resolve) => {
        const captured: Array<{ current: number; total: number; message?: string }> = []
        const timeout = setTimeout(() => resolve(captured), 20000)
        w.api.events.onImportProgress((payload) => {
          captured.push(payload)
          if (payload.current === payload.total) {
            clearTimeout(timeout)
            resolve(captured)
          }
        })
        void w.api.import.addFiles(paths)
      })
    }, filePaths)

    expect(events.length).toBeGreaterThan(0)

    const firstEvent = events[0]
    expect(typeof firstEvent.current).toBe('number')
    expect(typeof firstEvent.total).toBe('number')
    expect(firstEvent.total).toBe(filePaths.length)

    const lastEvent = events[events.length - 1]
    expect(lastEvent.current).toBe(lastEvent.total)
  })

  test('skips duplicate path and does not re-insert', async () => {
    const validPath = path.resolve(fixturesDir, 'valid.pdf')
    const ids = await electronPage.evaluate(async (p: string) => {
      const w = window as Window & { api: { import: { addFiles(paths: string[]): Promise<string[]> } } }
      return w.api.import.addFiles([p])
    }, validPath)
    expect(ids).toHaveLength(0)

    const docs = await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })
    expect(docs.length).toBeGreaterThanOrEqual(1)
    const found = docs.filter((d: DocumentItem) => d.filePath === validPath)
    expect(found).toHaveLength(1)
  })

  test('encrypted PDF returns empty result and does not insert', async () => {
    const docCountBefore = (await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })).length

    const encryptedPath = path.resolve(fixturesDir, 'encrypted.pdf')
    const ids = await electronPage.evaluate(async (p: string) => {
      const w = window as Window & { api: { import: { addFiles(paths: string[]): Promise<string[]> } } }
      return w.api.import.addFiles([p])
    }, encryptedPath)
    expect(ids).toHaveLength(0)

    const docCountAfter = (await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })).length
    expect(docCountAfter).toBe(docCountBefore)
  })

  test('corrupted PDF returns empty result and does not insert', async () => {
    const docCountBefore = (await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })).length

    const corruptedPath = path.resolve(fixturesDir, 'corrupted.pdf')
    const ids = await electronPage.evaluate(async (p: string) => {
      const w = window as Window & { api: { import: { addFiles(paths: string[]): Promise<string[]> } } }
      return w.api.import.addFiles([p])
    }, corruptedPath)
    expect(ids).toHaveLength(0)

    const docCountAfter = (await electronPage.evaluate(async () => {
      const w = window as Window & { api: { documents: { list(filter: { mode: string }): Promise<DocumentItem[]> } } }
      return w.api.documents.list({ mode: 'all' })
    })).length
    expect(docCountAfter).toBe(docCountBefore)
  })
})
