import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  file: { level: false as false | string },
  console: { level: false as false | string },
  warn: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

vi.mock('electron-log', () => ({
  default: {
    transports: { file: mocks.file, console: mocks.console },
    warn: mocks.warn
  }
}))

import { initLogger } from '../../src/main/services/logger'

describe('logger', () => {
  it('disables console logging when its output stream reports an error', () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    initLogger({ stdout, stderr })

    const error = Object.assign(new Error('write EIO'), { code: 'EIO' })
    stdout.emit('error', error)

    expect(mocks.file.level).toBe('debug')
    expect(mocks.console.level).toBe(false)
    expect(mocks.warn).toHaveBeenCalledWith('logger:console-disabled EIO: write EIO')
  })
})
