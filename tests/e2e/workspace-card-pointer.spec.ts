import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import electronExe from 'electron'

const testMain = path.resolve(__dirname, 'electron-main.mjs')

type WorkspaceItem = {
  id: string
  noteId: string | null
  x: number
  y: number
  width: number
  height: number
}

type ElectronApi = {
  documents: {
    get(id: string): Promise<{
      filePath: string
      fileHash: string | null
      updatedAt: number
    } | null>
    previewUrl(id: string, version: string | number): string
  }
  import: {
    addFiles(paths: string[]): Promise<{
      added: string[]
      skipped: string[]
      errors: Array<{ path: string; message: string }>
    }>
  }
  library: {
    switch(folder: string): Promise<unknown>
  }
  workspaces: {
    create(name: string): Promise<{ id: string }>
  }
  workspaceNotes: {
    create(
      workspaceId: string,
      title: string,
      contentMd: string,
      noteType: 'markdown',
      placement: { x: number; y: number }
    ): Promise<{ id: string }>
  }
  workspaceItems: {
    list(workspaceId: string): Promise<WorkspaceItem[]>
    add(
      workspaceId: string,
      kind: 'document',
      ids: string[],
      placement: { x: number; y: number }
    ): Promise<WorkspaceItem[]>
    resize(id: string, width: number, height: number): Promise<WorkspaceItem>
  }
}

test.describe('Workspace card pointer gestures', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let electronPage: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>
  let userDataFolder: string
  let libraryFolder: string
  const mainLogs: string[] = []

  test.beforeAll(async () => {
    userDataFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'refora-e2e-user-data-'))
    libraryFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'refora-e2e-pointer-'))
    const launchEnv = {
      ...process.env,
      REFORA_E2E_USER_DATA_DIR: userDataFolder
    }
    delete launchEnv.ELECTRON_RUN_AS_NODE

    electronApp = await electron.launch({
      executablePath: electronExe,
      env: launchEnv,
      args: [testMain]
    })
    electronApp.process().stdout?.on('data', (chunk: Buffer) => mainLogs.push(chunk.toString()))
    electronApp.process().stderr?.on('data', (chunk: Buffer) => mainLogs.push(chunk.toString()))
    electronPage = await electronApp.firstWindow()

    const actualUserDataFolder = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    expect(actualUserDataFolder).toBe(userDataFolder)
  })

  test.afterAll(async () => {
    await Promise.race([
      electronApp?.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 3000))
    ]).catch(() => {})
    try { fs.rmSync(userDataFolder, { recursive: true, force: true }) } catch { void 0 }
    try { fs.rmSync(libraryFolder, { recursive: true, force: true }) } catch { void 0 }
  })

  test('uses the native click after small movement and suppresses the click after a drag', async () => {
    const workspaceName = 'Pointer gesture workspace'
    const noteTitle = 'Pointer gesture note'
    const noteContent = 'Reader opened from the browser-generated click.'
    const setup = await electronPage.evaluate(
      async ({ folder, workspaceName: name, noteTitle: title, noteContent: content }) => {
        const electronApi = (window as Window & { api: ElectronApi }).api
        await electronApi.library.switch(folder)
        const workspace = await electronApi.workspaces.create(name)
        const note = await electronApi.workspaceNotes.create(
          workspace.id,
          title,
          content,
          'markdown',
          { x: 80, y: 80 }
        )
        const item = (await electronApi.workspaceItems.list(workspace.id))
          .find((candidate) => candidate.noteId === note.id)
        if (!item) throw new Error('Workspace note item was not created')
        return { workspaceId: workspace.id, item }
      },
      { folder: libraryFolder, workspaceName, noteTitle, noteContent }
    )

    await electronPage.reload({ waitUntil: 'domcontentloaded' })
    await electronPage.getByRole('button', { name: workspaceName, exact: true }).click()

    const noteCard = electronPage.locator('[data-card-kind="note"]').filter({ hasText: noteTitle })
    const card = electronPage.locator('[data-workspace-card]').filter({ has: noteCard })
    await expect(noteCard).toBeVisible()

    const dragBox = await noteCard.boundingBox()
    if (!dragBox) throw new Error('Workspace note card has no bounding box')
    const dragStart = { x: dragBox.x + 40, y: dragBox.y + 90 }

    await electronPage.mouse.move(dragStart.x, dragStart.y)
    await electronPage.mouse.down()
    await electronPage.mouse.move(dragStart.x + 30, dragStart.y + 20, { steps: 2 })
    await electronPage.mouse.up()

    await expect(card).toBeVisible()
    await expect(electronPage.locator('article.markdown-body')).toHaveCount(0)
    await expect.poll(() => electronPage.evaluate(
      async ({ workspaceId, itemId }) => {
        const electronApi = (window as Window & { api: ElectronApi }).api
        const item = (await electronApi.workspaceItems.list(workspaceId))
          .find((candidate) => candidate.id === itemId)
        return item ? { x: item.x, y: item.y } : null
      },
      { workspaceId: setup.workspaceId, itemId: setup.item.id }
    )).toEqual({ x: setup.item.x + 30, y: setup.item.y + 20 })

    const clickBox = await noteCard.boundingBox()
    if (!clickBox) throw new Error('Moved workspace note card has no bounding box')
    const clickStart = { x: clickBox.x + 40, y: clickBox.y + 90 }

    await electronPage.mouse.move(clickStart.x, clickStart.y)
    await electronPage.mouse.down()
    await electronPage.mouse.move(clickStart.x + 4, clickStart.y)
    await electronPage.mouse.up()

    const reader = electronPage.locator('article.markdown-body')
    await expect(reader).toBeVisible()
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText(noteTitle)
    await expect(reader).toContainText(noteContent)
    await expect(electronPage.evaluate(
      async ({ workspaceId, itemId }) => {
        const electronApi = (window as Window & { api: ElectronApi }).api
        const item = (await electronApi.workspaceItems.list(workspaceId))
          .find((candidate) => candidate.id === itemId)
        return item ? { x: item.x, y: item.y } : null
      },
      { workspaceId: setup.workspaceId, itemId: setup.item.id }
    )).resolves.toEqual({ x: setup.item.x + 30, y: setup.item.y + 20 })
  })

  test('loads the first PDF page in a workspace paper card', async () => {
    const workspaceName = 'PDF preview workspace'
    const pdfPath = process.env.REFORA_E2E_PREVIEW_PDF ??
      path.resolve(__dirname, '..', 'fixtures', 'valid.pdf')
    const setup = await electronPage.evaluate(
      async ({ folder, workspaceName: name, pdfPath: sourcePath }) => {
        const electronApi = (window as Window & { api: ElectronApi }).api
        await electronApi.library.switch(folder)
        const imported = await electronApi.import.addFiles([sourcePath])
        if (imported.added.length !== 1) {
          throw new Error(`PDF import failed: ${JSON.stringify(imported)}`)
        }
        const workspace = await electronApi.workspaces.create(name)
        const [item] = await electronApi.workspaceItems.add(
          workspace.id,
          'document',
          imported.added,
          { x: 80, y: 80 }
        )
        const resizedItem = await electronApi.workspaceItems.resize(item.id, 300, 500)
        const document = await electronApi.documents.get(imported.added[0])
        if (!document) throw new Error('Imported PDF was not found')
        return {
          workspaceId: workspace.id,
          docId: imported.added[0],
          filePath: document.filePath,
          item: resizedItem
        }
      },
      { folder: libraryFolder, workspaceName, pdfPath }
    )

    const summaryDb = new DatabaseSync(path.join(libraryFolder, 'refora.db'))
    const summaryTimestamp = Date.now()
    summaryDb.prepare(
      `INSERT INTO ai_summaries (docId, model, summaryJson, fullText, createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, ?, ?)`
    ).run(
      setup.docId,
      'e2e-model',
      JSON.stringify({
        core: 'E2E summary core',
        keyPoints: ['E2E key point'],
        methods: 'E2E methods',
        contribution: 'E2E contribution'
      }),
      summaryTimestamp,
      summaryTimestamp
    )
    summaryDb.close()

    await electronPage.reload({ waitUntil: 'domcontentloaded' })
    await electronPage.getByRole('button', { name: workspaceName, exact: true }).click()

    const preview = electronPage.locator('[data-paper-preview] img')
    await expect(preview).toBeVisible()
    await expect.poll(() => preview.evaluate(
      (image: HTMLImageElement) => image.complete ? image.naturalWidth : 0
    )).toBeGreaterThan(0).catch((error: Error) => {
      throw new Error(`${error.message}\nElectron logs:\n${mainLogs.join('')}`)
    })
    await expect.poll(() => preview.evaluate(
      (image: HTMLImageElement) => image.complete ? image.naturalHeight : 0
    )).toBeGreaterThan(0)
    const layout = await electronPage.locator('[data-paper-preview]').evaluate((element) => {
      const previewBounds = element.getBoundingClientRect()
      const detailsBounds = element.parentElement?.querySelector('[data-paper-details]')?.getBoundingClientRect()
      const containerBounds = element.parentElement?.getBoundingClientRect()
      return {
        previewHeight: previewBounds.height,
        previewWidth: previewBounds.width,
        detailsWidth: detailsBounds?.width ?? 0,
        containerHeight: containerBounds?.height ?? 0,
        containerWidth: containerBounds?.width ?? 0,
        gap: detailsBounds ? detailsBounds.left - previewBounds.right : Number.NaN
      }
    })
    expect(Math.abs(layout.previewHeight - layout.containerHeight)).toBeLessThan(1)
    expect(layout.previewWidth).toBeLessThanOrEqual(layout.containerWidth * 0.7 + 1)
    expect(layout.detailsWidth).toBeGreaterThanOrEqual(layout.containerWidth * 0.3 - 1)
    expect(Math.abs(layout.gap)).toBeLessThan(1)
    await expect(electronPage.locator('[data-paper-preview]')).toHaveCSS('cursor', 'pointer')

    const previewUrl = await preview.getAttribute('src')
    if (!previewUrl) throw new Error('Paper preview has no URL')
    const cacheControl = await electronApp.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url)
      await response.arrayBuffer()
      return response.headers.get('cache-control')
    }, previewUrl)
    expect(cacheControl).toBe('no-store')

    const previewCacheRoot = path.join(libraryFolder, '.refora', 'derived', 'pdf-previews')
    await expect.poll(() => {
      if (!fs.existsSync(previewCacheRoot)) return 0
      return fs.readdirSync(previewCacheRoot).reduce((count, directory) => {
        const directoryPath = path.join(previewCacheRoot, directory)
        if (!fs.statSync(directoryPath).isDirectory()) return count
        return count + fs.readdirSync(directoryPath).filter((name) => name.endsWith('.png')).length
      }, 0)
    }).toBeGreaterThan(0)

    const initialCacheCount = fs.readdirSync(previewCacheRoot).reduce((count, directory) => {
      const directoryPath = path.join(previewCacheRoot, directory)
      if (!fs.statSync(directoryPath).isDirectory()) return count
      return count + fs.readdirSync(directoryPath).filter((name) => name.endsWith('.png')).length
    }, 0)
    const sourceStats = fs.statSync(setup.filePath)
    fs.utimesSync(
      setup.filePath,
      sourceStats.atime,
      new Date(sourceStats.mtimeMs + 5000)
    )
    await electronApp.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url)
      await response.arrayBuffer()
    }, previewUrl)
    await expect.poll(() => fs.readdirSync(previewCacheRoot).reduce((count, directory) => {
      const directoryPath = path.join(previewCacheRoot, directory)
      if (!fs.statSync(directoryPath).isDirectory()) return count
      return count + fs.readdirSync(directoryPath).filter((name) => name.endsWith('.png')).length
    }, 0)).toBe(initialCacheCount + 1)

    const previewBounds = await electronPage.locator('[data-paper-preview]').boundingBox()
    if (!previewBounds) throw new Error('Paper preview has no bounding box')
    await electronPage.mouse.move(previewBounds.x + 40, previewBounds.y + 60)
    await electronPage.mouse.down()
    await electronPage.mouse.move(previewBounds.x + 70, previewBounds.y + 80)
    await electronPage.mouse.up()

    await expect.poll(() => electronPage.evaluate(
      async ({ workspaceId, itemId }) => {
        const electronApi = (window as Window & { api: ElectronApi }).api
        const item = (await electronApi.workspaceItems.list(workspaceId))
          .find((candidate) => candidate.id === itemId)
        return item ? { x: item.x, y: item.y } : null
      },
      { workspaceId: setup.workspaceId, itemId: setup.item.id }
    )).toEqual({ x: setup.item.x + 30, y: setup.item.y + 20 })

    await electronPage.locator('[data-paper-details]').click()
    const summaryReader = electronPage.locator('article.markdown-body')
    await expect(summaryReader).toBeVisible()
    await expect(summaryReader).toContainText('E2E summary core')
  })
})
