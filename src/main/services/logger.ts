import log from 'electron-log'
import { app } from 'electron'

let initialized = false

export function initLogger(): void {
  if (initialized) return
  const level = app.isPackaged ? 'info' : 'debug'
  log.transports.file.level = level
  log.transports.console.level = level
  initialized = true
}

export const logger = log
