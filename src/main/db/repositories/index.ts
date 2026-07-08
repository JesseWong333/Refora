import type { SqliteDb } from '../types'
import { createDocumentsRepository } from './documents'
import { createCategoriesRepository } from './categories'
import { createWatchFoldersRepository } from './watchFolders'
import { createSettingsRepository } from './settings'

export function createRepositories(db: SqliteDb) {
  const settings = createSettingsRepository(db)
  const documents = createDocumentsRepository(db, {
    getLibraryFolder: () => settings.get<string>('libraryFolderPath', '')
  })
  const categories = createCategoriesRepository(db)
  const watchFolders = createWatchFoldersRepository(db)
  return {
    documents,
    categories,
    watchFolders,
    settings
  }
}

export type Repositories = ReturnType<typeof createRepositories>
