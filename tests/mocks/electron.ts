import { vi } from 'vitest'
import { EventEmitter } from 'node:events'

export function mockElectron() {
  vi.mock('electron', () => ({
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/fake/doc.pdf'] }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 0 })
    },
    utilityProcess: {
      fork: vi.fn(() => {
        const child = new EventEmitter()
        ;(child as EventEmitter & { kill: () => void }).kill = vi.fn()
        return child
      })
    },
    BrowserWindow: class {
      webContents = { send: vi.fn() }
      isDestroyed = () => false
      on = vi.fn()
      close = vi.fn()
    },
    app: {
      getPath: vi.fn((name: string) => `/fake/path/${name}`),
      getLocale: () => 'en',
      on: vi.fn(),
      whenReady: () => Promise.resolve()
    },
    shell: {
      openPath: vi.fn().mockResolvedValue(''),
      showItemInFolder: vi.fn()
    }
  }))
}
