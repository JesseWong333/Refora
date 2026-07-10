import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Modal, Button, Input, Select } from '@lobehub/ui'
import { Loader2 } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { api } from '../ipc'
import { changeLanguage, type AppLanguage } from '../i18n'
import { errorMessage } from '../../shared/ipc-types'
import type { AiProvider, ModelVariantFormat, ProviderModelInfo } from '../../shared/ipc-types'
import {
  COMMON_VARIANTS,
  composeModelId,
  parseModelId,
  supportsModelVariants
} from '../../shared/modelVariant'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
]

const LANG_OPTIONS = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

interface ProviderForm {
  id: string | null
  name: string
  baseUrl: string
  baseModel: string
  variant: string
  variantFormat: ModelVariantFormat
  apiKey: string
  temperature: string
  maxTokens: string
}

type TestState = 'testing' | { ok: boolean; models?: string[] }
type KeyStatus = 'idle' | 'checking' | 'ok' | 'fail'

const PROVIDER_TEMPLATES: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Zhipu (智谱)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' }
]

const VARIANT_FORMAT_OPTIONS: { label: string; value: ModelVariantFormat }[] = [
  { label: 'base-variant', value: 'dash' },
  { label: 'base:variant', value: 'colon' },
  { label: 'base only', value: 'none' }
]

function AiProvidersSection() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [form, setForm] = useState<ProviderForm | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState<ProviderModelInfo[]>([])
  const [modelFilter, setModelFilter] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('idle')
  const [manualModel, setManualModel] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const fetchSeq = useRef(0)

  const load = async () => {
    try {
      const [list, active] = await Promise.all([
        api.aiProviders.list(),
        api.settings.get<string>('activeProviderId', '')
      ])
      setProviders(list)
      setActiveProviderId(active)
    } catch (e) {
      setError(errorMessage(e, 'Failed to load AI providers'))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const composedModel = form
    ? composeModelId(form.baseModel, form.variant, form.variantFormat)
    : ''

  const fetchModels = useCallback(
    async (opts: { baseUrl: string; apiKey?: string; providerId?: string | null }) => {
      const seq = ++fetchSeq.current
      setLoadingModels(true)
      setModelsError(null)
      setKeyStatus('checking')
      try {
        const result = await api.aiProviders.listModels({
          providerId: opts.providerId ?? undefined,
          baseUrl: opts.baseUrl.trim() || undefined,
          apiKey: opts.apiKey?.trim() || undefined
        })
        if (seq !== fetchSeq.current) return
        if (result.ok) {
          setAvailableModels(result.models)
          setKeyStatus('ok')
          setManualModel(result.models.length === 0)
          if (result.models.length === 0) {
            setModelsError(
              t(
                'settings.aiProviders.modelsEmpty',
                'No models returned. Enter a model id manually.'
              )
            )
          }
        } else {
          setAvailableModels([])
          setKeyStatus('fail')
          setManualModel(true)
          setModelsError(
            result.error ||
              t('settings.aiProviders.modelsFetchFail', 'Could not load models. Enter a model id manually.')
          )
        }
      } catch (e) {
        if (seq !== fetchSeq.current) return
        setAvailableModels([])
        setKeyStatus('fail')
        setManualModel(true)
        setModelsError(errorMessage(e, 'Could not load models'))
      } finally {
        if (seq === fetchSeq.current) setLoadingModels(false)
      }
    },
    [t]
  )

  const startAdd = () => {
    setError(null)
    setAvailableModels([])
    setModelFilter('')
    setKeyStatus('idle')
    setManualModel(false)
    setModelsError(null)
    setForm({
      id: null,
      name: '',
      baseUrl: '',
      baseModel: '',
      variant: '',
      variantFormat: 'dash',
      apiKey: '',
      temperature: '',
      maxTokens: ''
    })
  }

  const startEdit = (p: AiProvider) => {
    setError(null)
    setAvailableModels([])
    setModelFilter('')
    setKeyStatus(p.hasKey ? 'ok' : 'idle')
    setManualModel(false)
    setModelsError(null)
    const parsed = parseModelId(p.model)
    setForm({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      baseModel: p.baseModel || parsed.baseModel || p.model,
      variant: p.variant || parsed.variant,
      variantFormat: p.variantFormat || 'dash',
      apiKey: '',
      temperature: p.temperature?.toString() ?? '',
      maxTokens: p.maxTokens?.toString() ?? ''
    })
    if (p.hasKey) {
      void fetchModels({ providerId: p.id, baseUrl: p.baseUrl })
    }
  }

  const cancelForm = () => {
    setForm(null)
    setAvailableModels([])
    setModelsError(null)
    setKeyStatus('idle')
  }

  const saveForm = async () => {
    if (!form) return
    const baseModel = form.baseModel.trim()
    if (!form.name.trim() || !form.baseUrl.trim() || !baseModel) {
      setError(
        t(
          'settings.aiProviders.requiredFields',
          'Name, Base URL and Model are required'
        )
      )
      return
    }
    const model = composeModelId(baseModel, form.variant, form.variantFormat)
    setSaving(true)
    setError(null)
    try {
      if (form.id) {
        await api.aiProviders.update(form.id, {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model,
          baseModel,
          variant: form.variant.trim(),
          variantFormat: form.variantFormat,
          temperature: form.temperature.trim() ? parseFloat(form.temperature.trim()) : null,
          maxTokens: form.maxTokens.trim() ? parseInt(form.maxTokens.trim(), 10) : null,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
        })
      } else {
        await api.aiProviders.create({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model,
          baseModel,
          variant: form.variant.trim(),
          variantFormat: form.variantFormat,
          temperature: form.temperature.trim() ? parseFloat(form.temperature.trim()) : null,
          maxTokens: form.maxTokens.trim() ? parseInt(form.maxTokens.trim(), 10) : null,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
        })
      }
      setForm(null)
      await load()
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'encryption_unavailable') {
        setError(
          t(
            'settings.aiProviders.encryptionUnavailable',
            'OS keychain is unavailable. API keys cannot be securely stored on this system.'
          )
        )
      } else {
        setError(errorMessage(e, 'Failed to save provider'))
      }
    } finally {
      setSaving(false)
    }
  }

  const removeProvider = async (p: AiProvider) => {
    setError(null)
    try {
      await api.aiProviders.delete(p.id)
      if (activeProviderId === p.id) {
        await api.settings.set('activeProviderId', '')
        setActiveProviderId('')
      }
      await load()
    } catch (e) {
      setError(errorMessage(e, 'Failed to delete provider'))
    }
  }

  const testProvider = async (p: AiProvider) => {
    setError(null)
    setTestStates((prev) => ({ ...prev, [p.id]: 'testing' }))
    try {
      const result = await api.aiProviders.test(p.id)
      setTestStates((prev) => ({ ...prev, [p.id]: result }))
    } catch (e) {
      setTestStates((prev) => ({ ...prev, [p.id]: { ok: false } }))
      setError(errorMessage(e, 'Test failed'))
    }
  }

  const setActive = async (p: AiProvider) => {
    setError(null)
    try {
      await api.settings.set('activeProviderId', p.id)
      setActiveProviderId(p.id)
    } catch (e) {
      setError(errorMessage(e, 'Failed to set active provider'))
    }
  }

  const onApiKeyBlur = () => {
    if (!form) return
    if (!form.apiKey.trim() && form.id) {
      void fetchModels({ providerId: form.id, baseUrl: form.baseUrl })
      return
    }
    if (!form.apiKey.trim() || !form.baseUrl.trim()) return
    void fetchModels({
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      providerId: form.id
    })
  }

  const filteredModels = availableModels.filter((m) =>
    modelFilter.trim()
      ? m.id.toLowerCase().includes(modelFilter.trim().toLowerCase())
      : true
  )

  const showVariant =
    !!form &&
    (supportsModelVariants(form.baseModel) ||
      availableModels.some((m) => m.id === form.baseModel && m.supportsVariants) ||
      !!form.variant)

  const variantOptions = [
    { label: t('settings.aiProviders.variantNone', 'None (base only)'), value: '' },
    ...COMMON_VARIANTS.map((v) => ({ label: v, value: v }))
  ]

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted">
          {t('settings.aiProviders.title', 'AI Providers')}
        </label>
        {!form && (
          <Button size="small" onClick={startAdd}>
            {t('settings.aiProviders.add', 'Add')}
          </Button>
        )}
      </div>

      {form && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-3">
          {!form.id && (
            <div className="flex flex-wrap gap-1">
              {PROVIDER_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  type="button"
                  className="rounded-md border border-border bg-panel-2 px-2 py-1 text-[11px] text-muted hover:border-accent hover:text-foreground"
                  onClick={() => {
                    const parsed = parseModelId(tpl.model)
                    setForm({
                      ...form,
                      name: tpl.name,
                      baseUrl: tpl.baseUrl,
                      baseModel: parsed.baseModel || tpl.model,
                      variant: parsed.variant,
                      variantFormat: 'dash'
                    })
                  }}
                >
                  {tpl.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted">
              {t('settings.aiProviders.name', 'Name')}
            </label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="OpenAI"
              size="small"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted">
              {t('settings.aiProviders.baseUrl', 'Base URL')}
            </label>
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              size="small"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] text-muted">
              {t('settings.aiProviders.apiKey', 'API Key')}
              {form.id && (
                <span className="ml-1 text-muted">
                  ({t('settings.aiProviders.apiKeyHint', 'leave blank to keep current')})
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                onBlur={onApiKeyBlur}
                placeholder={form.id ? '' : 'sk-...'}
                size="small"
                className="flex-1"
              />
              <span
                className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${
                  keyStatus === 'ok'
                    ? 'bg-green-500'
                    : keyStatus === 'fail'
                      ? 'bg-red-500'
                      : keyStatus === 'checking'
                        ? 'bg-yellow-500'
                        : 'bg-border'
                }`}
                title={
                  keyStatus === 'ok'
                    ? t('settings.aiProviders.keyOk', 'API key valid')
                    : keyStatus === 'fail'
                      ? t('settings.aiProviders.keyFail', 'API key check failed')
                      : keyStatus === 'checking'
                        ? t('settings.aiProviders.keyChecking', 'Checking…')
                        : t('settings.aiProviders.keyIdle', 'Not checked')
                }
              />
              <Button
                size="small"
                onClick={() =>
                  void fetchModels({
                    baseUrl: form.baseUrl,
                    apiKey: form.apiKey || undefined,
                    providerId: form.id
                  })
                }
                loading={loadingModels}
                disabled={!form.baseUrl.trim() || (!form.apiKey.trim() && !form.id)}
              >
                {t('settings.aiProviders.fetchModels', 'Fetch models')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] text-muted">
                {t('settings.aiProviders.baseModel', 'Base model')}
              </label>
              <button
                type="button"
                className="text-[11px] text-accent hover:underline"
                onClick={() => setManualModel((v) => !v)}
              >
                {manualModel
                  ? t('settings.aiProviders.useList', 'Use model list')
                  : t('settings.aiProviders.manualModel', 'Enter manually')}
              </button>
            </div>
            {manualModel || availableModels.length === 0 ? (
              <Input
                value={form.baseModel}
                onChange={(e) => setForm({ ...form, baseModel: e.target.value })}
                placeholder="gpt-4o-mini"
                size="small"
              />
            ) : (
              <>
                <Input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder={t(
                    'settings.aiProviders.searchModels',
                    'Search models…'
                  )}
                  size="small"
                />
                <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-panel-2">
                  {loadingModels ? (
                    <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('settings.aiProviders.loadingModels', 'Loading models…')}
                    </div>
                  ) : filteredModels.length === 0 ? (
                    <div className="px-2 py-3 text-[11px] text-muted">
                      {t('settings.aiProviders.noModelMatch', 'No matching models')}
                    </div>
                  ) : (
                    filteredModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-hover ${
                          form.baseModel === m.id ? 'bg-active text-foreground' : 'text-muted'
                        }`}
                        onClick={() =>
                          setForm({
                            ...form,
                            baseModel: m.id,
                            variant: m.supportsVariants ? form.variant : ''
                          })
                        }
                      >
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {m.id}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {m.providerName && (
                            <span className="text-[10px] text-muted">{m.providerName}</span>
                          )}
                          {m.supportsVariants && (
                            <span className="rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">
                              {t('settings.aiProviders.hasVariants', 'variants')}
                            </span>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
            {modelsError && (
              <p className="text-[11px] text-muted">{modelsError}</p>
            )}
          </div>

          {showVariant && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-muted">
                  {t('settings.aiProviders.variant', 'Variant')}
                </label>
                <Select
                  value={form.variant}
                  onChange={(v: string) => setForm({ ...form, variant: v })}
                  options={variantOptions}
                  size="small"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] text-muted">
                  {t('settings.aiProviders.variantFormat', 'Variant format')}
                </label>
                <Select
                  value={form.variantFormat}
                  onChange={(v: ModelVariantFormat) =>
                    setForm({ ...form, variantFormat: v })
                  }
                  options={VARIANT_FORMAT_OPTIONS}
                  size="small"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-muted">
                {t('settings.aiProviders.temperature', 'Temperature (0-2)')}
              </label>
              <Input
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: e.target.value })}
                placeholder="0.7"
                size="small"
                type="number"
                min="0"
                max="2"
                step="0.1"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] text-muted">
                {t('settings.aiProviders.maxTokens', 'Max tokens')}
              </label>
              <Input
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
                placeholder="4096"
                size="small"
                type="number"
                min="1"
              />
            </div>
          </div>

          <div className="rounded-md bg-panel-2 px-2 py-1.5 text-[11px] text-muted">
            {t('settings.aiProviders.requestModel', 'Request model')}:{' '}
            <span className="font-medium text-foreground">{composedModel || '—'}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button size="small" onClick={cancelForm}>
              {t('settings.aiProviders.cancel', 'Cancel')}
            </Button>
            <Button size="small" type="primary" onClick={saveForm} loading={saving}>
              {t('settings.aiProviders.save', 'Save')}
            </Button>
          </div>
        </div>
      )}

      {!form && providers.length === 0 && (
        <span className="text-[11px] text-muted">
          {t('settings.aiProviders.noProviders', 'No providers configured.')}
        </span>
      )}

      {!form &&
        providers.map((p) => {
          const ts = testStates[p.id]
          const isActive = activeProviderId === p.id
          return (
            <div key={p.id} className="flex flex-col gap-1 rounded-lg bg-panel-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-foreground">{p.name}</span>
                    {isActive && (
                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-white">
                        {t('settings.aiProviders.active', 'Active')}
                      </span>
                    )}
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                      {p.hasKey
                        ? t('settings.aiProviders.hasKey', 'Key set')
                        : t('settings.aiProviders.noKey', 'No key')}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {p.model} · {p.baseUrl}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="small"
                    onClick={() => testProvider(p)}
                    loading={ts === 'testing'}
                  >
                    {t('settings.aiProviders.test', 'Test')}
                  </Button>
                  <Button size="small" onClick={() => startEdit(p)}>
                    {t('settings.aiProviders.edit', 'Edit')}
                  </Button>
                  {!isActive && (
                    <Button size="small" onClick={() => setActive(p)}>
                      {t('settings.aiProviders.setActive', 'Set Active')}
                    </Button>
                  )}
                  <Button size="small" onClick={() => removeProvider(p)}>
                    {t('settings.aiProviders.delete', 'Delete')}
                  </Button>
                </div>
              </div>
              {ts && ts !== 'testing' && (
                <div
                  className={`text-[11px] ${ts.ok ? 'text-foreground' : 'text-error'}`}
                >
                  {ts.ok
                    ? t('settings.aiProviders.testOk', {
                        count: ts.models?.length ?? 0,
                        defaultValue: `OK · {{count}} models`
                      })
                    : t('settings.aiProviders.testFail', 'Failed')}
                </div>
              )}
            </div>
          )
        })}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">{error}</div>
      )}
    </div>
  )
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, i18n } = useTranslation()
  const { mode: themeMode, setMode: setThemeMode } = useTheme()
  const [libraryFolderPath, setLibraryFolderPath] = useState('')
  const [proxyUrl, setProxyUrl] = useState('')
  const [crossrefMailto, setCrossrefMailto] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (open) {
      setError(null)
      void loadSettings()
    }
  }, [open])

  const loadSettings = async () => {
    try {
      const lib = await api.settings.get<string>('libraryFolderPath', '')
      const proxy = await api.settings.get<string>('proxyUrl', '')
      const mailto = await api.settings.get<string>('crossrefMailto', '')
      const sc = await api.settings.get<string>('sidebarCollapsed', '0')
      setLibraryFolderPath(lib)
      setProxyUrl(proxy)
      setCrossrefMailto(mailto)
      setSidebarCollapsed(sc === '1')
    } catch {
      setError('Failed to load settings')
    }
  }

  const handleChooseFolder = async () => {
    setError(null)
    try {
      const path = await api.dialog.openDirectory()
      if (!path) return
      setSwitching(true)
      await api.library.switch(path)
      setLibraryFolderPath(path)
    } catch (e) {
      setError(errorMessage(e, 'Failed to set library folder'))
    } finally {
      setSwitching(false)
    }
  }

  const saveProxy = async () => {
    setError(null)
    try {
      await api.settings.set('proxyUrl', proxyUrl)
    } catch (e) {
      setError(errorMessage(e, 'Failed to save proxy'))
    }
  }

  const saveMailto = async () => {
    setError(null)
    try {
      await api.settings.set('crossrefMailto', crossrefMailto)
    } catch (e) {
      setError(errorMessage(e, 'Failed to save mailto'))
    }
  }

  const handleSidebarToggle = async () => {
    const newVal = !sidebarCollapsed
    setSidebarCollapsed(newVal)
    try {
      await api.settings.set('sidebarCollapsed', newVal ? '1' : '0')
    } catch (e) {
      setSidebarCollapsed(!newVal)
      setError(errorMessage(e, 'Failed to update sidebar'))
    }
  }

  const handleThemeChange = (value: string) => {
    setThemeMode(value as 'system' | 'dark' | 'light')
  }

  const handleLanguageChange = async (value: string) => {
    const lang = value as AppLanguage
    setError(null)
    try {
      await api.settings.set('language', lang)
      await changeLanguage(lang)
    } catch (e) {
      setError(errorMessage(e, 'Failed to change language'))
    }
  }

  const currentLang = (i18n.language?.startsWith('zh') ? 'zh' : 'en') as AppLanguage

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('settings.title')}
      footer={
        <Button onClick={onClose} type="primary">
          {t('common.done')}
        </Button>
      }
      destroyOnClose
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.libraryFolder')}</label>
          <div className="flex gap-2">
            <span className="min-w-0 flex-1 truncate rounded-lg bg-panel-2 px-3 py-1.5 text-xs text-foreground">
              {libraryFolderPath || '\u2014'}
            </span>
            <Button size="small" onClick={handleChooseFolder} loading={switching}>
              {switching ? t('settings.switching') : t('settings.chooseFolder')}
            </Button>
          </div>
          <span className="text-[11px] text-muted">{t('settings.libraryFolderAutoImportHint')}</span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.proxy')}</label>
          <Input
            value={proxyUrl}
            onChange={(e) => setProxyUrl(e.target.value)}
            onBlur={saveProxy}
            onPressEnter={saveProxy}
            placeholder="http://proxy:8080"
            size="small"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted">{t('settings.crossrefMailto')}</label>
          <Input
            value={crossrefMailto}
            onChange={(e) => setCrossrefMailto(e.target.value)}
            onBlur={saveMailto}
            onPressEnter={saveMailto}
            placeholder="user@example.com"
            size="small"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">{t('settings.theme')}</label>
          <Select
            value={themeMode}
            onChange={handleThemeChange}
            options={THEME_OPTIONS}
            size="small"
            style={{ width: 120 }}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs text-muted">{t('settings.language')}</label>
          <Select
            value={currentLang}
            onChange={handleLanguageChange}
            options={LANG_OPTIONS}
            size="small"
            style={{ width: 120 }}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="m-0"
            checked={sidebarCollapsed}
            onChange={handleSidebarToggle}
          />
          <span className="text-xs text-foreground">
            {t('settings.sidebarCollapsed')}
          </span>
        </label>

        <AiProvidersSection />
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-error">
          {error}
        </div>
      )}
    </Modal>
  )
}
