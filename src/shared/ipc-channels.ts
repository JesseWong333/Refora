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
  DocumentsOpenPdf: 'documents:openPdf',
  DocumentsOpenInFinder: 'documents:openInFinder',
  DocumentsRefreshMetadata: 'documents:refreshMetadata',
  DocumentsRelocateFile: 'documents:relocateFile',
  DocumentsRestoreFile: 'documents:restoreFile',
  DocumentsFolderGroups: 'documents:folderGroups',

  ImportAddFiles: 'import:addFiles',
  ImportAddFolder: 'import:addFolder',
  ImportFromJson: 'import:fromJson',

  CategoriesList: 'categories:list',
  CategoriesCreate: 'categories:create',
  CategoriesRename: 'categories:rename',
  CategoriesDelete: 'categories:delete',
  CategoriesSetMoveToLibrary: 'categories:setMoveToLibrary',
  CategoriesAssign: 'categories:assign',
  CategoriesUnassign: 'categories:unassign',

  WatchList: 'watch:list',
  WatchAdd: 'watch:add',
  WatchRemove: 'watch:remove',
  WatchToggle: 'watch:toggle',

  DialogOpenDirectory: 'dialog:openDirectory',

  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',

  ExportToJson: 'export:toJson',
  ExportToBibtex: 'export:toBibtex',

  EventDocumentUpdated: 'document:updated',
  EventImportProgress: 'import:progress',
  EventImportToast: 'import:toast',
  EventMenuExportBibtex: 'menu:export-bibtex'
} as const
