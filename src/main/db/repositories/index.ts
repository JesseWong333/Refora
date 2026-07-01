import type { SqliteDb } from '../types'
import { createDocumentsRepository } from './documents'
import { createCategoriesRepository } from './categories'
import { createWatchFoldersRepository } from './watchFolders'
import { createSettingsRepository } from './settings'

export function createRepositories(db: SqliteDb) {
  return {
    documents: createDocumentsRepository(db),
    categories: createCategoriesRepository(db),
    watchFolders: createWatchFoldersRepository(db),
    settings: createSettingsRepository(db)
  }
}

export type Repositories = ReturnType<typeof createRepositories>
