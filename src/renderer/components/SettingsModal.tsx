import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import { Modal, Button, Input, Select } from '@lobehub/ui'
import { useTheme } from '../hooks/useTheme'
import { api } from '../ipc'
import { changeLanguage, type AppLanguage } from '../i18n'
import { errorMessage } from '../../shared/ipc-types'
import type { AiProvider } from '../../shared/ipc-types'

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
  model: string
  apiKey: string
}

type TestState = 'testing' | { ok: boolean; models?: string[] }

const PROVIDER_TEMPLATES: { name: string; baseUrl: string; model: string }[] = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Zhipu (智谱)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1' }
]

function AiProvidersSection() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [form, setForm] = useState<ProviderForm | null>(null)
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  const startAdd = () => {
    setError(null)
    setForm({ id: null, name: '', baseUrl: '', model: '', apiKey: '' })
  }

  const startEdit = (p: AiProvider) => {
    setError(null)
    setForm({ id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: '' })
  }

  const cancelForm = () => {
    setForm(null)
  }

  const saveForm = async () => {
    if (!form) return
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      setError('Name, Base URL and Model are required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (form.id) {
        const patch: Record<string, string> = {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim()
        }
        if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim()
        await api.aiProviders.update(form.id, patch)
      } else {
        await api.aiProviders.create({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
        })
      }
      setForm(null)
      await load()
    } catch (e) {
      setError(errorMessage(e, 'Failed to save provider'))
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
                  onClick={() => setForm({ ...form, name: tpl.name, baseUrl: tpl.baseUrl, model: tpl.model })}
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
              {t('settings.aiProviders.model', 'Model')}
            </label>
            <Input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="gpt-4o-mini"
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
            <Input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={form.id ? '' : 'sk-...'}
              size="small"
            />
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
