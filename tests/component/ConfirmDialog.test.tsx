import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: { count?: number }) => opts?.count != null ? `${k}-${opts.count}` : k })
}))

vi.mock('@lobehub/ui', async () => import('../mocks/lobehub-ui'))

import ConfirmDialog from '../../src/renderer/components/ConfirmDialog'
import { useDocumentStore } from '../../src/renderer/store/documentStore'
import { useConfirmStore } from '../../src/renderer/store/confirmStore'

describe('ConfirmDialog', () => {
  beforeEach(() => {
    useDocumentStore.setState({ confirmDelete: null })
    useConfirmStore.setState({ request: null })
  })

  afterEach(() => {
    cleanup()
    useDocumentStore.setState({ confirmDelete: null })
    useConfirmStore.setState({ request: null })
  })

  it('renders nothing when no confirm request or delete', () => {
    const { container } = render(<ConfirmDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('renders confirm-store request and calls onConfirm on confirm', () => {
    const onConfirm = vi.fn()
    useConfirmStore.getState().show({ title: 'Are you sure?', message: 'Really?', confirmText: 'Yes', cancelText: 'No', danger: true, onConfirm })
    render(<ConfirmDialog />)
    expect(screen.getByText('Really?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(useConfirmStore.getState().request).toBeNull()
  })

  it('dismisses on cancel', () => {
    const onConfirm = vi.fn()
    useConfirmStore.getState().show({ title: 't', message: 'm', onConfirm })
    render(<ConfirmDialog />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(useConfirmStore.getState().request).toBeNull()
  })

  it('renders bulk delete message when multiple ids and no custom message', () => {
    useDocumentStore.setState({ confirmDelete: { ids: ['a', 'b'], message: '' } })
    render(<ConfirmDialog />)
    expect(screen.getByText('dialog.deleteConfirmBulk-2')).toBeInTheDocument()
  })

  it('renders single delete message when one id and no custom message', () => {
    useDocumentStore.setState({ confirmDelete: { ids: ['a'], message: '' } })
    render(<ConfirmDialog />)
    expect(screen.getByText('dialog.deleteConfirm')).toBeInTheDocument()
  })

  it('uses custom delete message when provided', () => {
    useDocumentStore.setState({ confirmDelete: { ids: ['a'], message: 'Special warning' } })
    render(<ConfirmDialog />)
    expect(screen.getByText('Special warning')).toBeInTheDocument()
  })

  it('calls confirmDeleteAction on delete confirm', () => {
    const action = vi.fn()
    useDocumentStore.setState({ confirmDelete: { ids: ['a'], message: '' } })
    useDocumentStore.setState({ confirmDeleteAction: action } as never)
    render(<ConfirmDialog />)
    fireEvent.click(screen.getByText('common.delete'))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('calls cancelDelete on cancel of delete dialog', () => {
    const cancel = vi.fn()
    useDocumentStore.setState({ confirmDelete: { ids: ['a'], message: '' }, cancelDelete: cancel } as never)
    render(<ConfirmDialog />)
    fireEvent.click(screen.getByText('common.cancel'))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
