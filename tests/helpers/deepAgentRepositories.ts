import { vi } from 'vitest'
import type { Repositories } from '../../src/main/db/repositories'

export function withDeepAgentRepositories(repos: Repositories): Repositories {
  const mutable = repos as unknown as Record<string, unknown>
  const chat = mutable.chat as Record<string, unknown>
  chat.updateAgentState ??= vi.fn()
  if (vi.isMockFunction(chat.addMessage)) {
    chat.addMessage.mockImplementation((threadId: string, role: string, content: string) => ({
      id: `message-${chat.addMessage.mock.calls.length}`,
      threadId,
      role,
      content,
      createdAt: 0
    }))
  }
  mutable.agentMemories ??= {
    get: vi.fn(() => null),
    list: vi.fn(() => []),
    upsert: vi.fn((input) => ({
      ...input,
      revision: 1,
      createdAt: 0,
      updatedAt: 0
    })),
    delete: vi.fn(() => true)
  }
  mutable.agentRuns ??= {
    create: vi.fn((input) => ({
      ...input,
      checkpointAfter: null,
      assistantMessageId: null,
      endedAt: null,
      error: null,
      createdAt: 0
    })),
    get: vi.fn(() => null),
    update: vi.fn()
  }
  mutable.agentInterrupts ??= {
    create: vi.fn(),
    getPendingByThread: vi.fn(() => null),
    getPendingByRun: vi.fn(() => null),
    resolve: vi.fn()
  }
  mutable.agentToolEffects ??= {
    get: vi.fn(() => null),
    begin: vi.fn(),
    finish: vi.fn()
  }
  mutable.transaction ??= vi.fn((fn: () => unknown) => fn())
  return repos
}
