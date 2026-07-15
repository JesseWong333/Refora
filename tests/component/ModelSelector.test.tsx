import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, ProviderModelInfo } from '../../src/shared/ipc-types'
import ModelSelector from '../../src/renderer/components/workspace/ModelSelector'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key
  })
}))

vi.mock('../../src/renderer/hooks/useClickOutside', () => ({
  useClickOutside: vi.fn()
}))

const provider: AiProvider = {
  id: 'provider-1',
  presetId: 'openai',
  name: 'Provider One',
  baseUrl: 'https://api.example.com',
  apiProtocol: 'openai-responses',
  reasoningControl: 'openai',
  reasoningEffort: 'medium',
  model: 'gpt-5-high',
  baseModel: 'gpt-5',
  variant: 'high',
  variantFormat: 'dash',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

const providerModel: ProviderModelInfo = {
  id: 'model-alpha',
  supportsVariants: true,
  supportsReasoning: true,
  reasoningEfforts: ['low', 'high'],
  supportsVision: true,
  supportsTools: true,
  supportedParameters: []
}

const defaultProps: React.ComponentProps<typeof ModelSelector> = {
  providers: [provider],
  activeProviderId: provider.id,
  selectedModel: 'gpt-5',
  selectedVariant: 'high',
  providerModels: [providerModel],
  recentModels: [{ model: 'recent-model-high', providerId: provider.id }],
  loadingModels: false,
  deepThinking: false,
  thinkingMode: 'none',
  requestModel: 'gpt-5-high',
  streaming: false,
  onApplyModel: vi.fn().mockResolvedValue(undefined),
  onToggleDeepThinking: vi.fn()
}

function renderSelector(overrides: Partial<React.ComponentProps<typeof ModelSelector>> = {}) {
  return render(<ModelSelector {...defaultProps} {...overrides} />)
}

describe('ModelSelector', () => {
  beforeEach(() => {
    defaultProps.onApplyModel = vi.fn().mockResolvedValue(undefined)
    defaultProps.onToggleDeepThinking = vi.fn()
  })

  afterEach(cleanup)

  it('disables model and thinking controls without configured providers', () => {
    renderSelector({ providers: [], requestModel: '' })
    expect(screen.getByRole('button', { name: 'Select model / provider' })).toBeDisabled()
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deep thinking' })).toBeDisabled()
  })

  it('applies a configured provider model and closes the menu', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: 'Select model / provider' }))
    await user.click(screen.getByRole('option', { name: /^Provider One gpt-5-high$/ }))

    expect(defaultProps.onApplyModel).toHaveBeenCalledWith('gpt-5', 'high', 'provider-1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('applies available and recent model entries', async () => {
    const user = userEvent.setup()
    renderSelector()

    const trigger = screen.getByRole('button', { name: 'Select model / provider' })
    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: /model-alpha/ }))
    expect(defaultProps.onApplyModel).toHaveBeenCalledWith('model-alpha', '', undefined)

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: /recent-model-high/ }))
    expect(defaultProps.onApplyModel).toHaveBeenCalledWith(
      'recent-model',
      'high',
      'provider-1'
    )
  })

  it('validates and applies a custom model with Enter', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: 'Select model / provider' }))

    const input = screen.getByPlaceholderText('model-id')
    await user.type(input, 'invalid model')
    expect(screen.getByText('Model ID cannot contain spaces.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'custom-model-high{Enter}')
    expect(defaultProps.onApplyModel).toHaveBeenCalledWith('custom-model', 'high')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('applies explicit variants and toggles deep thinking', async () => {
    const user = userEvent.setup()
    renderSelector({ deepThinking: true, thinkingMode: 'native' })

    await user.click(screen.getByRole('button', { name: 'Select model / provider' }))
    await user.click(screen.getByRole('button', { name: 'xhigh' }))
    expect(defaultProps.onApplyModel).toHaveBeenCalledWith('gpt-5', 'xhigh', undefined)

    await user.click(screen.getByRole('button', { name: 'Native reasoning (model-powered)' }))
    expect(defaultProps.onToggleDeepThinking).toHaveBeenCalledOnce()
  })

  it('supports keyboard navigation and Escape in the model list', async () => {
    const user = userEvent.setup()
    renderSelector()
    await user.click(screen.getByRole('button', { name: 'Select model / provider' }))

    const listbox = screen.getByRole('listbox')
    const options = screen.getAllByRole('option')
    options[0].focus()
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(options[1]).toHaveFocus()
    fireEvent.keyDown(listbox, { key: 'ArrowUp' })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
