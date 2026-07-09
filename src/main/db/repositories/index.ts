import type { SqliteDb } from '../types'
import { createDocumentsRepository } from './documents'
import { createCategoriesRepository } from './categories'
import { createWatchFoldersRepository } from './watchFolders'
import { createSettingsRepository } from './settings'
import { createWorkspacesRepository } from './workspaces'
import { createWorkspaceItemsRepository } from './workspaceItems'
import { createAiSummariesRepository } from './aiSummaries'
import { createAiReportsRepository } from './aiReports'
import { createChatRepository } from './chat'
import { createAgentTracesRepository } from './agentTraces'
import { createAiProvidersRepository } from './aiProviders'
import { RepoError } from './errors'

export function createRepositories(db: SqliteDb) {
  const settings = createSettingsRepository(db)
  const documents = createDocumentsRepository(db, {
    getLibraryFolder: () => settings.get<string>('libraryFolderPath', '')
  })
  const categories = createCategoriesRepository(db)
  const watchFolders = createWatchFoldersRepository(db)
  const workspaces = createWorkspacesRepository(db)
  const workspaceItems = createWorkspaceItemsRepository(db)
  const aiSummaries = createAiSummariesRepository(db)
  const aiReports = createAiReportsRepository(db)
  const chat = createChatRepository(db)
  const agentTraces = createAgentTracesRepository(db)
  const aiProviders = createAiProvidersRepository(db)

  let depth = 0

  function transaction<T>(fn: () => T): T {
    const outer = depth === 0
    const savepoint = `sp_${depth}`
    if (outer) {
      db.exec('BEGIN')
    } else {
      db.exec(`SAVEPOINT ${savepoint}`)
    }
    depth += 1
    try {
      const result = fn()
      if (result != null && typeof (result as { then?: unknown }).then === 'function') {
        throw new RepoError(
          'transaction_callback_must_be_sync',
          'transaction callbacks must be synchronous'
        )
      }
      if (outer) {
        db.exec('COMMIT')
      } else {
        db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      }
      return result
    } catch (err) {
      if (outer) {
        db.exec('ROLLBACK')
      } else {
        db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        db.exec(`RELEASE SAVEPOINT ${savepoint}`)
      }
      throw err
    } finally {
      depth -= 1
    }
  }

  return {
    documents,
    categories,
    watchFolders,
    settings,
    workspaces,
    workspaceItems,
    aiSummaries,
    aiReports,
    chat,
    agentTraces,
    aiProviders,
    transaction
  }
}

export type Repositories = ReturnType<typeof createRepositories>
