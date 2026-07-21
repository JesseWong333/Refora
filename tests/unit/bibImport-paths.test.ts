import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  extractAttachmentPaths,
  extractMetadataFromEntry,
  importFromBibtex,
  parseBibtex
} from '../../src/main/services/bibImport'
import { createRepositories } from '../../src/main/db/repositories'
import { createMainTestDb, migrateMainTestDb } from '../helpers/mainDb'

describe('extractAttachmentPaths', () => {
  it('extracts a Zotero description path before the MIME type', () => {
    expect(
      extractAttachmentPaths('Full Text PDF:/Users/test/Papers/paper.pdf:application/pdf')
    ).toEqual(['/Users/test/Papers/paper.pdf'])
  })

  it('preserves relative attachment paths', () => {
    expect(extractAttachmentPaths('attachments/paper.pdf:application/pdf')).toEqual([
      'attachments/paper.pdf'
    ])
  })

  it('decodes file URLs', () => {
    expect(extractAttachmentPaths('Attachment:file:///Users/test/My%20Paper.pdf:application/pdf'))
      .toEqual(['/Users/test/My Paper.pdf'])
  })

  it('extracts an arXiv eprint only when its archive prefix is arXiv', () => {
    const [arxivEntry] = parseBibtex(`@misc{paper,
      title = {Verified Paper},
      eprint = {2401.12345v2},
      archivePrefix = {arXiv}
    }`)
    const [otherEntry] = parseBibtex(`@misc{paper,
      eprint = {2401.12345v2},
      archivePrefix = {Other}
    }`)

    expect(extractMetadataFromEntry(arxivEntry).arxivId).toBe('2401.12345v2')
    expect(extractMetadataFromEntry(otherEntry).arxivId).toBeUndefined()
  })

  it('persists a BibTeX arXiv ID only through the verification callback', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'refora-bib-arxiv-'))
    const filePath = join(directory, 'papers.bib')
    writeFileSync(filePath, `@misc{paper,
      title = {Verified Paper},
      author = {Doe, Jane},
      year = {2024},
      eprint = {2401.12345},
      archivePrefix = {arXiv}
    }`)
    const db = createMainTestDb()
    const repos = createRepositories(migrateMainTestDb(db))
    const verifyArxivId = vi.fn(async (docId: string, input: string) => {
      expect(repos.documents.get(docId)?.arxivId).toBeNull()
      return repos.documents.update(docId, { arxivId: input })
    })

    try {
      const result = await importFromBibtex(repos, filePath, 'zotero', verifyArxivId)
      const imported = repos.documents.get(result.added[0])

      expect(verifyArxivId).toHaveBeenCalledWith(imported?.id, '2401.12345')
      expect(imported?.arxivId).toBe('2401.12345')
      expect(result.errors).toEqual([])
    } finally {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
