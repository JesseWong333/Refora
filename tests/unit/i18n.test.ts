import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import i18n, { detectLocale, initI18n, changeLanguage, type AppLanguage } from '../../src/renderer/i18n'

const originalLanguage = Object.getOwnPropertyDescriptor(navigator, 'language')

function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(navigator, 'language', { configurable: true, get: () => lang })
}

afterEach(() => {
  if (originalLanguage) {
    Object.defineProperty(navigator, 'language', originalLanguage)
  } else {
    setNavigatorLanguage('en-US')
  }
})

describe('detectLocale', () => {
  it('returns "zh" for Chinese locale prefixes', () => {
    for (const l of ['zh', 'zh-CN', 'zh-Hans', 'zh-TW']) {
      setNavigatorLanguage(l)
      expect(detectLocale()).toBe('zh')
    }
  })

  it('returns "en" for non-Chinese locales', () => {
    for (const l of ['en-US', 'fr', 'ja', 'de-DE']) {
      setNavigatorLanguage(l)
      expect(detectLocale()).toBe('en')
    }
  })

  it('returns "en" when navigator.language is empty', () => {
    setNavigatorLanguage('')
    expect(detectLocale()).toBe('en')
  })
})

describe('initI18n and changeLanguage', () => {
  beforeEach(async () => {
    initI18n('en')
    await i18n.changeLanguage('en')
  })

  it('initI18n sets the given language', () => {
    initI18n('zh')
    expect(i18n.language).toBe('zh')
  })

  it('initI18n defaults to detected locale when none provided', () => {
    setNavigatorLanguage('zh-CN')
    initI18n()
    expect(i18n.language).toBe('zh')
  })

  it('initI18n sets fallbackLng to en', () => {
    initI18n('zh')
    expect(i18n.options.fallbackLng).toEqual(["en"])
  })

  it('changeLanguage switches the active language', async () => {
    initI18n('en')
    expect(i18n.language).toBe('en')
    await changeLanguage('zh' as AppLanguage)
    expect(i18n.language).toBe('zh')
    await changeLanguage('en')
    expect(i18n.language).toBe('en')
  })

  it('translates a known key differently across languages', async () => {
    initI18n('en')
    const en = i18n.t('common.delete')
    await changeLanguage('zh')
    const zh = i18n.t('common.delete')
    expect(en).toBe('Delete')
    expect(zh).not.toBe('common.delete')
    expect(en).not.toBe(zh)
  })

  it('translates approval action names and descriptions across languages', async () => {
    const approvalKeys = [
      'workspace.chat.approvalPrepareOcr',
      'workspace.chat.approvalPrepareOcrDescription',
      'workspace.chat.approvalPaperTitle',
      'workspace.chat.approvalPaperTarget',
      'workspace.chat.approvalInstallPackages',
      'workspace.chat.approvalInstallPackagesDescription',
      'workspace.chat.approvalRuntimeList',
      'workspace.chat.approvalPythonPackageList',
      'workspace.chat.approvalPackageWithoutVersion',
      'workspace.chat.approvalPublishArtifacts',
      'workspace.chat.approvalPublishArtifactsDescription',
      'workspace.chat.approvalArtifactPathList',
      'workspace.chat.approvalUpdateMemory',
      'workspace.chat.approvalUpdateMemoryDescription',
      'workspace.chat.approvalMemoryContent',
      'workspace.chat.approvalMemoryRationale'
    ] as const

    initI18n('en')
    const english = approvalKeys.map((key) => i18n.t(key))
    await changeLanguage('zh')
    const chinese = approvalKeys.map((key) => i18n.t(key))

    for (let index = 0; index < approvalKeys.length; index++) {
      expect(english[index]).not.toBe(approvalKeys[index])
      expect(chinese[index]).not.toBe(approvalKeys[index])
      expect(chinese[index]).not.toBe(english[index])
    }
    expect(i18n.t('workspace.chat.approvalPrepareOcrDescription', {
      paper: '《示例论文》'
    })).toContain('示例论文')
  })
})
