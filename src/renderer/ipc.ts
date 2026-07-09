import type { ReforaApi } from '../shared/ipc-types'

const win = window as unknown as { api?: ReforaApi }

if (!win.api) {
  throw new Error('Refora API not available: preload script may have failed to load')
}

export const api: ReforaApi = win.api
