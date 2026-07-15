import { describe, expect, it } from 'vitest'
import { extractAttachmentPaths } from '../../src/main/services/bibImport'

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
})
