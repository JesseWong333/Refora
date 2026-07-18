import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import WorkspaceMarkdownView from '../../src/renderer/components/workspace/WorkspaceMarkdownView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

function renderView(overrides: Partial<React.ComponentProps<typeof WorkspaceMarkdownView>> = {}) {
  const onBack = vi.fn()
  const onUpdate = vi.fn().mockResolvedValue(true)
  const view = render(
    <WorkspaceMarkdownView
      kind="note"
      id="note-1"
      title="Research notes"
      contentMd={'# Findings\n\nInitial content'}
      timestamp={1}
      onBack={onBack}
      onUpdate={onUpdate}
      {...overrides}
    />
  )
  return { onBack, onUpdate, ...view }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WorkspaceMarkdownView', () => {
  it('keeps the fullscreen toolbar draggable while preserving interactive controls', () => {
    renderView({ fullscreen: true })

    const backButton = screen.getByRole('button', { name: 'workspace.markdownBackToBoard' })
    expect(backButton.closest('.h-8')).toHaveClass('drag-region')
    expect(backButton).toHaveClass('no-drag')
  })

  it('opens in reading mode and exposes a reading/editing switch', () => {
    renderView()

    expect(screen.getByRole('heading', { name: 'Research notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.markdownRead' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'workspace.markdownEdit' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'workspace.markdownEdit' }))

    expect(screen.getByRole('textbox', { name: 'workspace.noteTitleLabel' })).toHaveValue('Research notes')
    expect(screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })).toHaveValue('# Findings\n\nInitial content')
  })

  it('saves a changed draft before returning to reading mode', async () => {
    const { onUpdate } = renderView({ initialMode: 'edit' })
    const content = screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })
    fireEvent.change(content, { target: { value: 'Updated content' } })

    fireEvent.click(screen.getByRole('button', { name: 'workspace.markdownRead' }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith('note-1', {
        title: 'Research notes',
        contentMd: 'Updated content'
      })
      expect(screen.getByRole('button', { name: 'workspace.markdownRead' })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.getByText('Updated content')).toBeInTheDocument()
  })

  it('automatically saves changes after 800ms without editor field labels or a save button', async () => {
    vi.useFakeTimers()
    const { onUpdate } = renderView({ initialMode: 'edit' })
    const title = screen.getByRole('textbox', { name: 'workspace.noteTitleLabel' })
    const content = screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })

    expect(screen.queryByText('workspace.noteTitleLabel')).not.toBeInTheDocument()
    expect(screen.queryByText('workspace.noteContentLabel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workspace.noteSave' })).not.toBeInTheDocument()
    expect(title).toHaveClass('bg-transparent', 'border-transparent', 'hover:bg-transparent', 'focus:bg-transparent', 'focus:ring-0', 'focus-visible:outline-none')
    expect(content).toHaveClass('bg-transparent', 'border-transparent', 'hover:bg-transparent', 'focus:bg-transparent', 'focus:ring-0', 'focus-visible:outline-none')

    fireEvent.change(content, { target: { value: 'Autosaved content' } })

    await act(async () => {
      vi.advanceTimersByTime(799)
    })
    expect(onUpdate).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onUpdate).toHaveBeenCalledWith('note-1', {
      title: 'Research notes',
      contentMd: 'Autosaved content'
    })
  })

  it('queues a newer automatic save until an earlier save finishes', async () => {
    vi.useFakeTimers()
    const { onUpdate } = renderView({ initialMode: 'edit' })
    let resolveFirstSave: (saved: boolean) => void = () => undefined
    let resolveSecondSave: (saved: boolean) => void = () => undefined
    onUpdate
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveFirstSave = resolve
      }))
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveSecondSave = resolve
      }))
    const content = screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })

    fireEvent.change(content, { target: { value: 'First version' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(onUpdate).toHaveBeenLastCalledWith('note-1', {
      title: 'Research notes',
      contentMd: 'First version'
    })

    fireEvent.change(content, { target: { value: 'Second version' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(onUpdate).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstSave(true)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onUpdate).toHaveBeenLastCalledWith('note-1', {
      title: 'Research notes',
      contentMd: 'Second version'
    })

    await act(async () => {
      resolveSecondSave(true)
      await Promise.resolve()
    })
  })

  it('keeps the draft open when returning to reading mode cannot save it', async () => {
    const onUpdate = vi.fn().mockResolvedValue(false)
    renderView({ initialMode: 'edit', onUpdate })
    const content = screen.getByRole('textbox', { name: 'workspace.noteContentLabel' })
    fireEvent.change(content, { target: { value: 'Unsaved content' } })

    fireEvent.click(screen.getByRole('button', { name: 'workspace.markdownRead' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('workspace.noteSaveFailed')
    })
    expect(content).toHaveValue('Unsaved content')
    expect(screen.getByRole('button', { name: 'workspace.markdownEdit' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a paper AI summary as a read-only reader without editor controls', () => {
    renderView({
      kind: 'summary',
      title: 'Paper title',
      contentMd: 'Core summary\n\n## Key Points\n\n- Point one',
      onUpdate: undefined
    })

    expect(screen.getByText('Core summary')).toBeInTheDocument()
    expect(screen.getByText('Point one')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workspace.markdownBackToBoard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'workspace.markdownEdit' })).not.toBeInTheDocument()
  })
})
