import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronDown,
  Sparkles
} from 'lucide-react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { Button as UiButton, Input as UiInput } from '../ui'
import {
  COMMON_VARIANTS,
  parseModelId,
  supportsModelVariants
} from '../../../shared/modelVariant'
import type { AiProvider, ProviderModelInfo } from '../../../shared/ipc-types'
import type { RecentModelEntry } from '../../utils/chatUtils'

export interface ModelSelectorProps {
  providers: AiProvider[]
  activeProviderId: string
  selectedModel: string
  selectedVariant: string
  providerModels: ProviderModelInfo[]
  recentModels: RecentModelEntry[]
  loadingModels: boolean
  deepThinking: boolean
  thinkingMode: string
  requestModel: string
  streaming: boolean
  onApplyModel: (baseModel: string, variant?: string, providerId?: string) => Promise<void>
  onToggleDeepThinking: () => void
}

export default function ModelSelector({
  providers,
  activeProviderId,
  selectedModel,
  selectedVariant,
  providerModels,
  recentModels,
  loadingModels,
  deepThinking,
  thinkingMode,
  requestModel,
  streaming,
  onApplyModel,
  onToggleDeepThinking
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  useClickOutside(menuRef, () => setModelMenuOpen(false), modelMenuOpen)

  const customModelTrimmed = customModel.trim()
  const customModelInvalid = !customModelTrimmed || /\s/.test(customModelTrimmed)
  const variantCapable =
    supportsModelVariants(selectedModel) ||
    providerModels.some((m) => m.id === selectedModel && m.supportsVariants)

  const displayModelLabel = providers.length === 0
    ? t('workspace.chat.notConfigured', 'Not configured')
    : requestModel || t('workspace.chat.selectProvider', 'Select model / provider')

  const handleApply = (baseModel: string, variant = '', providerId?: string) => {
    void onApplyModel(baseModel, variant, providerId)
    setModelMenuOpen(false)
  }

  const handleCustomModel = () => {
    const parsed = parseModelId(customModelTrimmed)
    void onApplyModel(parsed.baseModel, parsed.variant)
    setCustomModel('')
    setModelMenuOpen(false)
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          className="inline-flex max-w-[120px] items-center gap-1 rounded-lg px-2 py-1 text-label text-foreground transition-colors duration-150 hover:bg-hover disabled:opacity-40"
          onClick={() => setModelMenuOpen((v) => !v)}
          disabled={providers.length === 0 || streaming}
          aria-label={t('workspace.chat.selectProvider', 'Select model / provider')}
          aria-expanded={modelMenuOpen}
          aria-haspopup="listbox"
        >
          <span className="truncate font-medium">{displayModelLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
        </button>

        {modelMenuOpen && (
          <div
            className="absolute top-full right-0 z-50 mt-1 w-72 max-h-72 overflow-y-auto rounded-xl border border-border bg-panel p-2 shadow-lg"
            role="listbox"
            tabIndex={0}
            onKeyDown={(e) => {
              const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'))
              const currentIndex = buttons.findIndex((b) => b === document.activeElement)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                const next = buttons[Math.min(currentIndex + 1, buttons.length - 1)] ?? buttons[0]
                next?.focus()
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                const prev = buttons[Math.max(currentIndex - 1, 0)] ?? buttons[0]
                prev?.focus()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setModelMenuOpen(false)
              }
            }}
          >
            <p className="px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
              {t('workspace.chat.providerModels', 'Provider models')}
            </p>
            {providers.map((p) => (
              <button
                key={`p-${p.id}`}
                type="button"
                role="option"
                aria-selected={p.id === activeProviderId}
                className={`mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover ${
                  p.id === activeProviderId ? 'bg-active' : ''
                }`}
                onClick={() => {
                  const parsed = parseModelId(p.model)
                  handleApply(
                    p.baseModel || parsed.baseModel || p.model,
                    p.variant || parsed.variant,
                    p.id
                  )
                }}
              >
                <span className="truncate text-xs font-medium text-foreground">
                  {p.name}
                </span>
                <span className="truncate text-caption text-muted">{p.model}</span>
              </button>
            ))}

            {providerModels.length > 0 && (
              <>
                <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.chat.availableModels', 'Available models')}
                  {loadingModels ? '…' : ''}
                </p>
                {providerModels.slice(0, 40).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={m.id === selectedModel}
                    className="mb-0.5 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-hover"
                    onClick={() => handleApply(m.id, '')}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{m.id}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {m.supportsVariants && (
                        <span className="text-caption text-accent">
                          {t('settings.aiProviders.hasVariants', 'variants')}
                        </span>
                      )}
                      {m.id === selectedModel && <Check className="h-3 w-3 text-accent" />}
                    </span>
                  </button>
                ))}
              </>
            )}

            {recentModels.length > 0 && (
              <>
                <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.chat.recentModels', 'Recent')}
                </p>
                {recentModels.map((entry) => {
                  const parsed = parseModelId(entry.model)
                  const providerName = providers.find((p) => p.id === entry.providerId)?.name
                  return (
                    <button
                      key={`r-${entry.model}`}
                      type="button"
                      role="option"
                      className="mb-0.5 flex w-full flex-col rounded-lg px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-150 hover:bg-hover"
                      onClick={() =>
                        handleApply(parsed.baseModel || entry.model, parsed.variant, entry.providerId)
                      }
                    >
                      <span className="truncate">{entry.model}</span>
                      {providerName && (
                        <span className="truncate text-caption text-muted">{providerName}</span>
                      )}
                    </button>
                  )
                })}
              </>
            )}

            <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
              {t('workspace.chat.customModel', 'Custom model')}
            </p>
            <div className="flex gap-1 px-1">
              <UiInput
                variant="outlined"
                inputSize="sm"
                className="min-w-0 flex-1"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="model-id"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !customModelInvalid) {
                    e.preventDefault()
                    handleCustomModel()
                  }
                }}
              />
              <UiButton
                variant="primary"
                size="sm"
                disabled={customModelInvalid}
                onClick={handleCustomModel}
              >
                {t('common.add', 'Add')}
              </UiButton>
            </div>
            {customModel && customModelInvalid && (
              <p className="px-1 pt-1 text-caption text-muted">
                {t('workspace.chat.customModelHint', 'Model ID cannot contain spaces.')}
              </p>
            )}

            {variantCapable && (
              <>
                <p className="mt-2 px-1 pb-1 text-caption font-semibold uppercase tracking-wide text-muted">
                  {t('workspace.chat.variant', 'Variant')}
                </p>
                <div className="flex flex-wrap gap-1 px-1 pb-1">
                  <button
                    type="button"
                    className={`rounded-md border px-2 py-0.5 text-caption ${
                      !selectedVariant
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-muted'
                    }`}
                    onClick={() => handleApply(selectedModel, '')}
                  >
                    {t('settings.aiProviders.variantNone', 'None (base only)')}
                  </button>
                  {COMMON_VARIANTS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={`rounded-md border px-2 py-0.5 text-caption ${
                        selectedVariant === v
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border text-muted'
                      }`}
                      onClick={() => handleApply(selectedModel, v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-label ${
          deepThinking
            ? 'bg-accent text-white'
            : 'text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground'
        } disabled:opacity-40`}
        onClick={onToggleDeepThinking}
        disabled={providers.length === 0 || streaming}
        aria-pressed={deepThinking}
        title={
          deepThinking && thinkingMode === 'native'
            ? t('workspace.chat.deepThinkingNative', 'Native reasoning (model-powered)')
            : deepThinking && thinkingMode === 'prompt'
              ? t('workspace.chat.deepThinkingPrompt', 'Prompt-enhanced (compatibility mode)')
              : t('workspace.chat.deepThinking', 'Deep thinking')
        }
        aria-label={
          deepThinking && thinkingMode === 'native'
            ? t('workspace.chat.deepThinkingNative', 'Native reasoning (model-powered)')
            : deepThinking && thinkingMode === 'prompt'
              ? t('workspace.chat.deepThinkingPrompt', 'Prompt-enhanced (compatibility mode)')
              : t('workspace.chat.deepThinking', 'Deep thinking')
        }
      >
        <Sparkles className="h-3.5 w-3.5" />
      </button>
    </>
  )
}
