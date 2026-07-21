import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMineruEngineManager } from '../../src/main/services/mineruEngineManager'
import { readMineruInstallRoot } from '../../src/main/services/prefs'

const directories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

function manager(userDataDir: string, trashItem = vi.fn(async (path: string) => {
  await rm(path, { recursive: true, force: true })
})) {
  return {
    trashItem,
    value: createMineruEngineManager({
      userDataDir,
      architecture: 'arm64',
      downloadFile: vi.fn(),
      trashItem
    })
  }
}

describe('MinerU engine manager paths', () => {
  it('uses a global default install root under userData', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const status = await manager(userData).value.getStatus()
    expect(status).toMatchObject({
      state: 'notInstalled',
      installRoot: join(userData, 'engines'),
      installPath: null,
      architecture: 'arm64'
    })
  })

  it('persists the user-selected root and keeps the managed path nested', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const selected = temporaryDirectory('refora-mineru-selected-')
    const instance = manager(userData).value
    const status = await instance.setInstallRoot(selected)
    expect(status.installRoot).toBe(selected)
    expect(readMineruInstallRoot(userData)).toBe(selected)
    mkdirSync(join(selected, 'Refora', 'MinerU', '3.4.4', 'darwin-arm64'), {
      recursive: true
    })
    expect((await instance.getStatus()).installPath).toBe(
      join(selected, 'Refora', 'MinerU', '3.4.4', 'darwin-arm64')
    )
  })

  it('rejects a symbolic-link install root', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const target = temporaryDirectory('refora-mineru-target-')
    const container = temporaryDirectory('refora-mineru-link-')
    const link = join(container, 'models')
    symlinkSync(target, link)
    await expect(manager(userData).value.setInstallRoot(link)).rejects.toThrow('regular directory')
  })

  it('rejects symbolic links inside the managed install path', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const selected = temporaryDirectory('refora-mineru-selected-')
    const outside = temporaryDirectory('refora-mineru-outside-')
    const created = manager(userData)
    await created.value.setInstallRoot(selected)
    symlinkSync(outside, join(selected, 'Refora'))

    await expect(created.value.getStatus()).resolves.toMatchObject({
      state: 'invalid',
      error: 'MinerU managed directories cannot be symbolic links'
    })
    await expect(created.value.uninstall()).rejects.toThrow(
      'MinerU managed directories cannot be symbolic links'
    )
    expect(created.trashItem).not.toHaveBeenCalled()
  })

  it('moves only the versioned managed directory to Trash on uninstall', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const selected = temporaryDirectory('refora-mineru-selected-')
    const created = manager(userData)
    await created.value.setInstallRoot(selected)
    const managed = join(selected, 'Refora', 'MinerU', '3.4.4', 'darwin-arm64')
    mkdirSync(managed, { recursive: true })
    expect((await created.value.getStatus()).state).toBe('invalid')
    expect((await created.value.uninstall()).state).toBe('notInstalled')
    expect(created.trashItem).toHaveBeenCalledWith(managed)
  })

  it('shares one installation attempt across concurrent callers', async () => {
    const userData = temporaryDirectory('refora-mineru-userdata-')
    const downloadFile = vi.fn(async () => {
      throw new Error('download stopped')
    })
    const instance = createMineruEngineManager({
      userDataDir: userData,
      architecture: 'arm64',
      downloadFile,
      trashItem: vi.fn()
    })

    const first = instance.install()
    const second = instance.install()

    await expect(first).rejects.toThrow('download stopped')
    await expect(second).rejects.toThrow('download stopped')
    expect(downloadFile).toHaveBeenCalledOnce()
  })
})
