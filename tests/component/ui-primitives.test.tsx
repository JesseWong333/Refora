import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { Toast } from '../../src/renderer/components/ui/Toast'
import { Badge } from '../../src/renderer/components/ui/Badge'
import { Card, cardClassName } from '../../src/renderer/components/ui/Card'
import { useDocumentStore } from '../../src/renderer/store/documentStore'

afterEach(() => {
  cleanup()
  useDocumentStore.setState({ toastMessage: null })
})

describe('Toast', () => {
  it('renders nothing when no toastMessage', () => {
    useDocumentStore.setState({ toastMessage: null })
    const { container } = render(<Toast />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the message with status role when set', () => {
    useDocumentStore.setState({ toastMessage: 'Saved' })
    render(<Toast />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })
})

describe('Badge', () => {
  it('renders children with default variant classes', () => {
    render(<Badge>new</Badge>)
    const el = screen.getByText('new')
    expect(el.className).toContain('bg-panel-2')
    expect(el.className).toContain('text-caption')
  })

  it('applies accent variant solid classes', () => {
    render(<Badge variant="accent">hot</Badge>)
    expect(screen.getByText('hot').className).toContain('bg-accent')
  })

  it('applies subtle classes when subtle=true', () => {
    render(<Badge variant="success" subtle>ok</Badge>)
    const el = screen.getByText('ok')
    expect(el.className).toContain('bg-success/15')
    expect(el.className).toContain('text-success')
  })

  it('applies md size classes', () => {
    render(<Badge size="md">x</Badge>)
    expect(screen.getByText('x').className).toContain('text-xs')
  })

  it('merges custom className', () => {
    render(<Badge className="my-extra">x</Badge>)
    expect(screen.getByText('x').className).toContain('my-extra')
  })

  it('forwards arbitrary props', () => {
    render(<Badge data-testid="b">x</Badge>)
    expect(screen.getByTestId('b')).toBeInTheDocument()
  })
})

describe('Card', () => {
  it('renders children and applies default variant class', () => {
    render(<Card>content</Card>)
    const el = screen.getByText('content')
    expect(el.className).toContain('border')
    expect(el.className).toContain('shadow-sm')
  })

  it('applies elevated variant with shadow-md', () => {
    render(<Card variant="elevated">c</Card>)
    expect(screen.getByText('c').className).toContain('shadow-md')
  })

  it('applies outlined variant without shadow', () => {
    render(<Card variant="outlined">c</Card>)
    const el = screen.getByText('c')
    expect(el.className).not.toContain('shadow-sm')
    expect(el.className).not.toContain('shadow-md')
  })

  it('adds hover class when hoverable', () => {
    render(<Card hoverable>c</Card>)
    expect(screen.getByText('c').className).toContain('hover:border-accent')
  })

  it('merges custom className', () => {
    render(<Card className="custom">c</Card>)
    expect(screen.getByText('c').className).toContain('custom')
  })

  it('forwards onClick', () => {
    const onClick = vi.fn()
    render(<Card onClick={onClick}>c</Card>)
    fireEvent.click(screen.getByText('c'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('cardClassName helper joins classes and filters falsy', () => {
    expect(cardClassName('elevated', true, 'extra')).toContain('shadow-md')
    expect(cardClassName('default', false)).not.toContain('hover:border-accent')
    expect(cardClassName('default', false, undefined)).not.toContain('undefined')
  })
})
