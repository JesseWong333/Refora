import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown> | string) => {
    if (typeof opts === 'string') return opts
    if (opts && typeof opts === 'object' && 'defaultValue' in opts) { let s = String(opts.defaultValue); for (const [kk, vv] of Object.entries(opts)) { if (kk !== 'defaultValue') s = s.replace(new RegExp('{{' + kk + '}}', 'g'), String(vv)); } return s; }
    if (opts && typeof opts === 'object' && 'count' in opts) return `Total: ${opts.count} tokens`
    return k
  }})
}))

import { AgentTracePanel } from '../../src/renderer/components/workspace/AgentTrace'
import type { AgentTraceStep } from '../../src/shared/ipc-types'

function step(over: Partial<AgentTraceStep> = {}): AgentTraceStep {
  return {
    id: 's1', threadId: 't', runId: 'r', kind: 'llm', name: null,
    input: null, output: null, status: 'done', startedAt: 1000, endedAt: 2000,
    seq: 0, inputTokens: null, outputTokens: null, totalTokens: null,
    ...over
  }
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

function headerButton() {
  return document.querySelector('button[aria-expanded]') as HTMLButtonElement
}

describe('AgentTracePanel', () => {
  it('renders nothing when no steps and not streaming', () => {
    const { container } = render(<AgentTracePanel steps={[]} streaming={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the panel header when streaming with no visible steps', () => {
    render(<AgentTracePanel steps={[]} streaming={true} />)
    expect(headerButton()).not.toBeNull()
  })

  it('shows step count in header', () => {
    render(<AgentTracePanel steps={[step({ id: 'a' }), step({ id: 'b' })]} streaming={false} />)
    expect(headerButton().textContent).toContain('2')
  })

  it('expands to show steps on header click', () => {
    const steps = [step({ id: 'a', kind: 'llm' }), step({ id: 'b', kind: 'tool', name: 'search_library' })]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    expect(headerButton().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(headerButton())
    expect(headerButton().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Searched library')).toBeInTheDocument()
  })

  it('auto-expands when streaming starts with steps', () => {
    render(<AgentTracePanel steps={[step({ id: 'a', status: 'running' })]} streaming={true} />)
    expect(headerButton().getAttribute('aria-expanded')).toBe('true')
  })

  it('shows total duration derived from visible steps', () => {
    const steps = [step({ id: 'a', startedAt: 1000, endedAt: 3500 })]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    expect(headerButton().textContent).toContain('2.5s')
  })

  it('shows token total when steps have totalTokens', () => {
    const steps = [step({ id: 'a', totalTokens: 500 }), step({ id: 'b', totalTokens: 250 })]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    expect(headerButton().textContent).toContain('Total: 750 tokens')
  })

  it('hides run-kind steps from visible count', () => {
    const steps = [step({ id: 'run', kind: 'run' }), step({ id: 'a', kind: 'llm' })]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    expect(headerButton().textContent).toContain('1')
  })

  it('shows running label when a step is still running', () => {
    render(<AgentTracePanel steps={[step({ id: 'a', status: 'running', endedAt: null })]} streaming={false} />)
    expect(headerButton().textContent).toContain('running…')
  })

  it('does not show running label when a step errored', () => {
    render(<AgentTracePanel steps={[step({ id: 'a', status: 'error' })]} streaming={false} />)
    expect(headerButton().textContent).not.toContain('running…')
  })

  it('expand all toggles step body visibility', () => {
    const steps = [step({ id: 'a', input: 'IN-A', output: 'OUT-A' })]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    fireEvent.click(headerButton())
    expect(screen.queryByText('IN-A')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Expand all'))
    expect(screen.getByText('IN-A')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Collapse all'))
    expect(screen.queryByText('IN-A')).not.toBeInTheDocument()
  })

  it('labels execution, dependency installation, and artifact publishing steps', () => {
    const steps = [
      step({ id: 'bash', kind: 'tool', name: 'run_bash' }),
      step({ id: 'install', kind: 'tool', name: 'install_runtime_packages' }),
      step({ id: 'publish', kind: 'tool', name: 'publish_workspace_artifacts' })
    ]
    render(<AgentTracePanel steps={steps} streaming={false} />)
    fireEvent.click(headerButton())
    expect(screen.getByText('Ran command')).toBeInTheDocument()
    expect(screen.getByText('Installed packages')).toBeInTheDocument()
    expect(screen.getByText('Published artifacts')).toBeInTheDocument()
  })

})
