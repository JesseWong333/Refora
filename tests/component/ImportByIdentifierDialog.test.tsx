import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  importByIdentifier: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

vi.mock('../../src/renderer/store/documentStore', () => ({
  useDocumentStore: Object.assign(
    (selector: (state: { importByIdentifier: typeof mocks.importByIdentifier }) => unknown) =>
      selector({ importByIdentifier: mocks.importByIdentifier }),
    { getState: () => ({ importByIdentifier: mocks.importByIdentifier }) }
  )
}))

import ImportByIdentifierDialog from '../../src/renderer/components/ImportByIdentifierDialog'

describe('ImportByIdentifierDialog', () => {
  beforeEach(() => {
    mocks.importByIdentifier.mockReset()
  })

  afterEach(cleanup)

  it('delegates a trimmed identifier to the store and closes immediately', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    const importButton = screen.getByRole('button', { name: 'identifierImport.import' })
    expect(importButton).toBeDisabled()
    await user.type(screen.getByPlaceholderText('identifierImport.placeholder'), '  10.1000/test  ')
    await user.click(importButton)

    expect(mocks.importByIdentifier).toHaveBeenCalledWith('10.1000/test')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('submits via Enter key', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    await user.type(screen.getByPlaceholderText('identifierImport.placeholder'), '2401.12345{Enter}')

    expect(mocks.importByIdentifier).toHaveBeenCalledWith('2401.12345')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does nothing when input is empty', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ImportByIdentifierDialog open onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'identifierImport.import' }))

    expect(mocks.importByIdentifier).not.toHaveBeenCalled()
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
