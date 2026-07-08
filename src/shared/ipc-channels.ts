export const IpcChannel = {
  Bootstrap: 'app:bootstrap',

  DocumentsList: 'documents:list',
  DocumentsSearch: 'documents:search',
  DocumentsGet: 'documents:get',
  DocumentsUpdate: 'documents:update',
  DocumentsSetStarred: 'documents:setStarred',
  DocumentsDelete: 'documents:delete',
  DocumentsBulkDelete: 'documents:bulkDelete',
  DocumentsBulkCategorize: 'documents:bulkCategorize',
  DocumentsBulkRefreshMetadata: 'documents:bulkRefreshMetadata',
  DocumentsCountPendingMetadata: 'documents:countPendingMetadata',
  DocumentsOpenPdf: 'documents:openPdf',
  DocumentsOpenInFinder: 'documents:openInFinder',
  DocumentsRefreshMetadata: 'documents:refreshMetadata',
  DocumentsRelocateFile: 'documents:relocateFile',
  DocumentsRestoreFile: 'documents:restoreFile',

  ImportAddFiles: 'import:addFiles',
  ImportAddFolder: 'import:addFolder',
  ImportFromJson: 'import:fromJson',

  CategoriesList: 'categories:list',
  CategoriesCreate: 'categories:create',
  CategoriesRename: 'categories:rename',
  CategoriesDelete: 'categories:delete',
  CategoriesAssign: 'categories:assign',
  CategoriesUnassign: 'categories:unassign',

  WatchList: 'watch:list',
  WatchAdd: 'watch:add',
  WatchRemove: 'watch:remove',
  WatchToggle: 'watch:toggle',

  DialogOpenDirectory: 'dialog:openDirectory',

  LibrarySwitch: 'library:switch',

  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',

  ExportToJson: 'export:toJson',
  ExportToBibtex: 'export:toBibtex',
  ExportBibtexString: 'export:bibtexString',

  EventDocumentUpdated: 'document:updated',
  EventImportProgress: 'import:progress',
  EventImportToast: 'import:toast',
  EventMenuExportBibtex: 'menu:export-bibtex',
  EventLibraryScanning: 'library:scanning',
  EventLibrarySwitched: 'library:switched'
} as const
