import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const ACADEMIC_ARTIFACT_MARKER_KEY = '__refora_academic_artifact__'
export const ACADEMIC_ARTIFACT_MARKER_PREFIX = 'refora-academic-artifact:v1:'

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000

interface StoredAcademicArtifact {
  version: 1
  type: string
  data: string
  createdAt: number
}

interface ArtifactFile {
  id: string | null
  path: string
  size: number
  modifiedAt: number
  temporary: boolean
}

function artifactId(type: string, data: Uint8Array): string {
  return createHash('sha256')
    .update(type)
    .update('\0')
    .update(data)
    .digest('hex')
}

function markerFor(id: string): string {
  return `${ACADEMIC_ARTIFACT_MARKER_PREFIX}${id}`
}

export function academicArtifactIdFromMarker(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(ACADEMIC_ARTIFACT_MARKER_PREFIX)) {
    return null
  }
  const id = value.slice(ACADEMIC_ARTIFACT_MARKER_PREFIX.length)
  return /^[a-f0-9]{64}$/.test(id) ? id : null
}

export function createAcademicCheckpointArtifactStore(root: string) {
  function pathFor(id: string): string {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid academic artifact ID')
    return join(root, id.slice(0, 2), `${id}.json`)
  }

  async function write(type: string, data: Uint8Array): Promise<string> {
    if (data.byteLength > MAX_ARTIFACT_BYTES) {
      throw new Error('Academic checkpoint artifact is too large')
    }
    const id = artifactId(type, data)
    const path = pathFor(id)
    try {
      await stat(path)
      return markerFor(id)
    } catch {
      const stored: StoredAcademicArtifact = {
        version: 1,
        type,
        data: Buffer.from(data).toString('base64'),
        createdAt: Date.now()
      }
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, path)
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      return markerFor(id)
    }
  }

  async function read(marker: string): Promise<{ type: string; data: Uint8Array } | null> {
    const id = academicArtifactIdFromMarker(marker)
    if (!id) return null
    const path = pathFor(id)
    try {
      const details = await stat(path)
      if (details.size > MAX_ARTIFACT_BYTES * 2) return null
      const stored = JSON.parse(await readFile(path, 'utf8')) as Partial<StoredAcademicArtifact>
      if (stored.version !== 1 || typeof stored.type !== 'string' || typeof stored.data !== 'string') {
        return null
      }
      const data = new Uint8Array(Buffer.from(stored.data, 'base64'))
      if (data.byteLength > MAX_ARTIFACT_BYTES || artifactId(stored.type, data) !== id) return null
      const now = new Date()
      await utimes(path, now, now).catch(() => undefined)
      return { type: stored.type, data }
    } catch {
      return null
    }
  }

  async function listFiles(directory: string): Promise<ArtifactFile[]> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return []
    }
    const files: ArtifactFile[] = []
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        files.push(...await listFiles(path))
      } else if (entry.isFile()) {
        const match = /^([a-f0-9]{64})\.json$/.exec(entry.name)
        const temporary =
          /^[a-f0-9]{64}\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i
            .test(entry.name)
        if (!match && !temporary) continue
        const details = await stat(path).catch(() => null)
        if (details) {
          files.push({
            id: match?.[1] ?? null,
            path,
            size: details.size,
            modifiedAt: details.mtimeMs,
            temporary
          })
        }
      }
    }
    return files
  }

  async function prune(
    referencedIds: Set<string>,
    options?: { maxBytes?: number; orphanAgeMs?: number }
  ): Promise<{ deletedFiles: number; deletedBytes: number; remainingBytes: number }> {
    const maxBytes = Math.max(0, options?.maxBytes ?? DEFAULT_MAX_BYTES)
    const orphanAgeMs = Math.max(0, options?.orphanAgeMs ?? DEFAULT_ORPHAN_AGE_MS)
    const cutoff = Date.now() - orphanAgeMs
    const files = await listFiles(root)
    const removable: ArtifactFile[] = []
    let deletedFiles = 0
    let deletedBytes = 0
    let remainingBytes = files.reduce((sum, file) => sum + file.size, 0)

    for (const file of files) {
      if (file.temporary) {
        const deleted = await unlink(file.path).then(() => true).catch(() => false)
        if (deleted) {
          deletedFiles += 1
          deletedBytes += file.size
          remainingBytes -= file.size
        }
        continue
      }
      if (!file.id) continue
      if (referencedIds.has(file.id)) continue
      if (file.modifiedAt <= cutoff) {
        const deleted = await unlink(file.path).then(() => true).catch(() => false)
        if (deleted) {
          deletedFiles += 1
          deletedBytes += file.size
          remainingBytes -= file.size
          continue
        }
      }
      removable.push(file)
    }

    for (const file of removable.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (remainingBytes <= maxBytes) break
      const deleted = await unlink(file.path).then(() => true).catch(() => false)
      if (!deleted) continue
      deletedFiles += 1
      deletedBytes += file.size
      remainingBytes -= file.size
    }

    return { deletedFiles, deletedBytes, remainingBytes }
  }

  async function deleteUnreferenced(
    candidateIds: Set<string>,
    referencedIds: Set<string>
  ): Promise<{ deletedFiles: number; deletedBytes: number }> {
    let deletedFiles = 0
    let deletedBytes = 0
    for (const id of candidateIds) {
      if (referencedIds.has(id) || !/^[a-f0-9]{64}$/.test(id)) continue
      const path = pathFor(id)
      const details = await stat(path).catch(() => null)
      if (!details) continue
      const deleted = await unlink(path).then(() => true).catch(() => false)
      if (!deleted) continue
      deletedFiles += 1
      deletedBytes += details.size
    }
    return { deletedFiles, deletedBytes }
  }

  return { root, write, read, prune, deleteUnreferenced }
}

export type AcademicCheckpointArtifactStore =
  ReturnType<typeof createAcademicCheckpointArtifactStore>
