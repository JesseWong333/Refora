import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchDocuments: vi.fn(),
  fromIdentifier: vi.fn(),
  showToast: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { message?: string }) =>
      options?.message ? `${key}: ${options.message}` : key
  })
}))

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

vi.mock('../../src/renderer/ipc', () => ({
  api: {
    import: {
      fromIdentifier: mocks.fromIdentifier
    }
  }
}))

vi.mock('../../src/renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector: (state: { fetchDocuments: typeof mocks.fetchDocuments }) => unknown) =>
      selector({ fetchDocuments: mocks.fetchDocuments }),
    { getState: () => ({ showToast: mocks.showToast }) }
  )
}))

import ImportByIdentifierDialog from '../../src/renderer/components/ImportByIdentifierDialog'

describe('ImportByIdentifierDialog', () => {
  beforeEach(() => {
    mocks.fetchDocuments.mockReset().mockResolvedValue(undefined)
    mocks.fromIdentifier.mockReset()
    mocks.showToast.mockReset()
  })

  afterEach(cleanup)

  it('imports a trimmed identifier and refreshes the document list', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.fromIdentifier.mockResolvedValue({ added: ['doc-1'] })
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    const importButton = screen.getByRole('button', { name: 'identifierImport.import' })
    expect(importButton).toBeDisabled()
    await user.type(screen.getByPlaceholderText('identifierImport.placeholder'), '  10.1000/test  ')
    await user.click(importButton)

    await waitFor(() => expect(mocks.fromIdentifier).toHaveBeenCalledWith('10.1000/test'))
    expect(mocks.showToast).toHaveBeenCalledWith('identifierImport.success')
    expect(mocks.fetchDocuments).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows the service message when no document was added', async () => {
    const user = userEvent.setup()
    mocks.fromIdentifier.mockResolvedValue({ added: [], message: 'Already imported' })
    render(<ImportByIdentifierDialog open onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('identifierImport.placeholder')
    await user.type(input, 'arXiv:1234.5678{Enter}')

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledWith('Already imported'))
  })

  it('keeps the dialog open and reports import failures', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mocks.fromIdentifier.mockRejectedValue(new Error('lookup failed'))
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    await user.type(screen.getByPlaceholderText('identifierImport.placeholder'), 'PMID:1')
    await user.click(screen.getByRole('button', { name: 'identifierImport.import' }))

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith('identifierImport.failed: lookup failed')
    })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('clears the input when cancelled', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    const input = screen.getByPlaceholderText('identifierImport.placeholder')
    await user.type(input, 'doi')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(input).toHaveValue('')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
