import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface CacheEnvelope<T> {
  schemaVersion: 1
  fetchedAt: number
  expiresAt: number
  value: T
}

interface CacheFile {
  path: string
  size: number
  modifiedAt: number
}

const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024

function cacheHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

export function createAcademicCache(root: string) {
  function jsonPath(namespace: string, key: string): string {
    const safeNamespace = namespace.replace(/[^a-z0-9-]/gi, '-')
    return join(root, safeNamespace, `${cacheHash(key)}.json`)
  }

  async function getJson<T>(
    namespace: string,
    key: string
  ): Promise<{ value: T; fetchedAt: number } | null> {
    const path = jsonPath(namespace, key)
    try {
      const envelope = JSON.parse(
        await readFile(path, 'utf8')
      ) as CacheEnvelope<T>
      if (envelope.schemaVersion !== 1 || envelope.expiresAt <= Date.now()) {
        await unlink(path).catch(() => undefined)
        return null
      }
      return { value: envelope.value, fetchedAt: envelope.fetchedAt }
    } catch {
      await unlink(path).catch(() => undefined)
      return null
    }
  }

  async function setJson<T>(
    namespace: string,
    key: string,
    value: T,
    ttlMs: number
  ): Promise<void> {
    const fetchedAt = Date.now()
    const envelope: CacheEnvelope<T> = {
      schemaVersion: 1,
      fetchedAt,
      expiresAt: fetchedAt + ttlMs,
      value
    }
    await writeAtomic(jsonPath(namespace, key), JSON.stringify(envelope))
  }

  async function listFiles(directory: string): Promise<CacheFile[]> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }
    const files: CacheFile[] = []
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        files.push(...await listFiles(path))
      } else if (entry.isFile()) {
        const details = await stat(path).catch(() => null)
        if (details) {
          files.push({
            path,
            size: details.size,
            modifiedAt: details.mtimeMs
          })
        }
      }
    }
    return files
  }

  async function prune(options?: {
    maxAgeMs?: number
    maxBytes?: number
  }): Promise<{ deletedFiles: number; deletedBytes: number; remainingBytes: number }> {
    const maxAgeMs = Math.max(0, options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS)
    const maxBytes = Math.max(0, options?.maxBytes ?? DEFAULT_MAX_BYTES)
    const cutoff = Date.now() - maxAgeMs
    const files = await listFiles(root)
    let deletedFiles = 0
    let deletedBytes = 0
    const remaining: CacheFile[] = []
    for (const file of files) {
      if (file.modifiedAt <= cutoff || file.path.endsWith('.tmp')) {
        const deleted = await unlink(file.path).then(() => true).catch(() => false)
        if (deleted) {
          deletedFiles += 1
          deletedBytes += file.size
        } else {
          remaining.push(file)
        }
      } else {
        remaining.push(file)
      }
    }
    let remainingBytes = remaining.reduce((sum, file) => sum + file.size, 0)
    for (const file of remaining.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (remainingBytes <= maxBytes) break
      const deleted = await unlink(file.path).then(() => true).catch(() => false)
      if (!deleted) continue
      deletedFiles += 1
      deletedBytes += file.size
      remainingBytes -= file.size
    }
    return { deletedFiles, deletedBytes, remainingBytes }
  }

  return {
    root,
    getJson,
    setJson,
    prune,
    readText: (path: string) => readFile(path, 'utf8'),
    writeText: writeAtomic,
    path: (...parts: string[]) => join(root, ...parts)
  }
}

export type AcademicCache = ReturnType<typeof createAcademicCache>
