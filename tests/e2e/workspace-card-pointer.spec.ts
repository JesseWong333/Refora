import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import electronExe from 'electron'

const testMain = path.resolve(__dirname, 'electron-main.mjs')

type WorkspaceItem = {
  id: string
  noteId: string | null
  x: number
  y: number
}

type ElectronApi = {
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
  }
}

test.describe('Workspace card pointer gestures', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>
  let electronPage: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>
  let userDataFolder: string
  let libraryFolder: string

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
})
