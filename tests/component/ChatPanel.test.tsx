import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ChatMessage, AiProvider } from '../../src/shared/ipc-types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() }
  })
}))

import { useWorkspaceStore } from '../../src/renderer/store/workspaceStore'
import { useDocumentStore } from '../../src/renderer/store/documentStore'

const ChatPanelModule = await import('../../src/renderer/components/workspace/ChatPanel')
const ChatPanel = ChatPanelModule.default
const { parseReforaDocLink } = ChatPanelModule

const mockChatHistory = vi.fn()
const mockOpenPdf = vi.fn()

const TEST_PROVIDER: AiProvider = {
  id: 'p1',
  name: 'Test Provider',
  baseUrl: 'http://localhost',
  model: 'gpt-4o',
  baseModel: 'gpt-4o',
  variant: '',
  variantFormat: 'dash',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 0
}

function makeMessage(content: string): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    threadId: 'thread-1',
    role: 'assistant',
    content,
    createdAt: Date.now()
  }
}

function setupApi(messages: ChatMessage[]): void {
  const w = window as unknown as { api: Record<string, Record<string, unknown>> }
  w.api.aiProviders.list = async () => [TEST_PROVIDER]
  w.api.aiProviders.listModels = async () => ({ ok: true, models: [] })
  w.api.aiProviders.update = async (id: string) => ({ ...TEST_PROVIDER, id })
  w.api.settings.get = async (_key: string, defaultValue: unknown) => defaultValue
  w.api.settings.set = async () => undefined
  w.api.ai.chatHistory = mockChatHistory
  w.api.ai.chatTraces = async () => []
  w.api.ai.chatThreads = async () => []
  w.api.documents.openPdf = mockOpenPdf
  mockChatHistory.mockResolvedValue(messages)
}

function setupStore(): void {
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeThreadId: 'thread-1',
    threads: [],
    fetchThreads: vi.fn().mockResolvedValue(undefined),
    deleteThread: vi.fn().mockResolvedValue(undefined),
    startNewChat: vi.fn(),
    setActiveThreadId: vi.fn()
  })
  useDocumentStore.setState({ showToast: vi.fn() })
}

beforeEach(() => {
  mockChatHistory.mockReset()
  mockOpenPdf.mockReset()
  mockOpenPdf.mockResolvedValue(null)
  setupStore()
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({
    activeWorkspaceId: null,
    activeThreadId: null,
    threads: []
  })
})

describe('parseReforaDocLink', () => {
  it('parses a simple doc link', () => {
    expect(parseReforaDocLink('refora://doc/abc')).toEqual({
      docId: 'abc',
      query: undefined
    })
  })

  it('parses a doc link with query parameter', () => {
    const result = parseReforaDocLink('refora://doc/abc?q=some+quote')
    expect(result).not.toBeNull()
    expect(result!.docId).toBe('abc')
    expect(result!.query).toBe('q=some+quote')
  })

  it('decodes encoded docId', () => {
    const result = parseReforaDocLink('refora://doc/my%20doc')
    expect(result).not.toBeNull()
    expect(result!.docId).toBe('my doc')
  })

  it('returns null for https links', () => {
    expect(parseReforaDocLink('https://example.com')).toBeNull()
  })

  it('returns null for empty href', () => {
    expect(parseReforaDocLink('')).toBeNull()
  })

  it('returns null for malformed refora links', () => {
    expect(parseReforaDocLink('refora://other/abc')).toBeNull()
    expect(parseReforaDocLink('refora://doc')).toBeNull()
  })
})

describe('ChatPanel citation links', () => {
  it('renders refora://doc/ link as a clickable button', async () => {
    setupApi([makeMessage('See [Test Paper](refora://doc/doc-123) for details.')])
    render(<ChatPanel />)

    const btn = await screen.findByRole('button', { name: /Test Paper/i })
    expect(btn.tagName).toBe('BUTTON')
    fireEvent.click(btn)

    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-123')
    })
  })

  it('does not render citation as an <a> with target=_blank', async () => {
    setupApi([makeMessage('See [Test Paper](refora://doc/doc-123) for details.')])
    render(<ChatPanel />)

    await screen.findByRole('button', { name: /Test Paper/i })
    const links = screen.queryAllByRole('link')
    const citationLinks = links.filter((l) => /Test Paper/i.test(l.textContent ?? ''))
    expect(citationLinks).toHaveLength(0)
  })

  it('renders regular https links as external <a> with target=_blank', async () => {
    setupApi([makeMessage('Check [Example](https://example.com) site.')])
    render(<ChatPanel />)

    const link = await screen.findByRole('link', { name: /Example/i })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders multiple citation links as separate buttons', async () => {
    setupApi([
      makeMessage('See [First](refora://doc/doc-a) and [Second](refora://doc/doc-b).')
    ])
    render(<ChatPanel />)

    const btnA = await screen.findByRole('button', { name: /First/i })
    const btnB = await screen.findByRole('button', { name: /Second/i })
    expect(btnA.tagName).toBe('BUTTON')
    expect(btnB.tagName).toBe('BUTTON')

    fireEvent.click(btnA)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-a')
    })

    fireEvent.click(btnB)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('doc-b')
    })
  })

  it('extracts docId correctly when query parameter is present', async () => {
    setupApi([makeMessage('See [Title](refora://doc/abc?q=some+quote).')])
    render(<ChatPanel />)

    const btn = await screen.findByRole('button', { name: /Title/i })
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.getAttribute('title')).toBe('q=some+quote')

    fireEvent.click(btn)
    await vi.waitFor(() => {
      expect(mockOpenPdf).toHaveBeenCalledWith('abc')
    })
  })
})
