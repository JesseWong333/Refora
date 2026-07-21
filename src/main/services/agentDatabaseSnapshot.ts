import { randomUUID } from 'node:crypto'
import { chmod, rename, rm } from 'node:fs/promises'
import type { SqliteDb } from '../db/types'
import type { AgentSandboxService } from './agentSandbox'

interface AgentDatabaseSnapshotDeps {
  db: SqliteDb
  sandboxService: AgentSandboxService
}

function sqliteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function createAgentDatabaseSnapshotService(deps: AgentDatabaseSnapshotDeps) {
  let activeRefresh: Promise<string> | null = null

  async function createSnapshot(): Promise<string> {
    const shared = await deps.sandboxService.ensureShared()
    const temporary = `${shared.databaseSnapshot}.tmp-${randomUUID()}`
    await rm(temporary, { force: true })
    try {
      if (deps.db.backup) {
        await deps.db.backup(temporary)
      } else {
        deps.db.exec(`VACUUM INTO ${sqliteLiteral(temporary)}`)
      }
      await chmod(temporary, 0o400)
      await rename(temporary, shared.databaseSnapshot)
      return shared.databaseSnapshot
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  function refresh(): Promise<string> {
    if (activeRefresh) return activeRefresh
    activeRefresh = createSnapshot().finally(() => {
      activeRefresh = null
    })
    return activeRefresh
  }

  return { refresh }
}

export type AgentDatabaseSnapshotService = ReturnType<typeof createAgentDatabaseSnapshotService>
