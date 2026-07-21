import log from 'electron-log'
import { app } from 'electron'

let initialized = false

type LoggerOutputStreams = {
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
}

export function initLogger(streams: LoggerOutputStreams = process): void {
  if (initialized) return
  const level = app.isPackaged ? 'info' : 'debug'
  log.transports.file.level = level
  log.transports.console.level = level
  const handleOutputError = (error: Error & { code?: string }): void => {
    if (log.transports.console.level === false) return
    log.transports.console.level = false
    log.warn(`logger:console-disabled ${error.code ?? error.name}: ${error.message}`)
  }
  streams.stdout?.on('error', handleOutputError)
  if (streams.stderr !== streams.stdout) {
    streams.stderr?.on('error', handleOutputError)
  }
  initialized = true
}

export const logger = log
