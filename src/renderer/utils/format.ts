const HOME_PREFIX = '/Users/'

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatFilePath(path: string): string {
  if (path.startsWith(HOME_PREFIX)) {
    const idx = path.indexOf('/', HOME_PREFIX.length)
    if (idx !== -1) return '~' + path.slice(idx)
  }
  return path
}

export function formatElapsedClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${String(totalMinutes).padStart(2, '0')}:${seconds}`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}
