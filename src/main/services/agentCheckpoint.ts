import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

export const AGENT_STATE_VERSION = 1

export function createAgentCheckpointService(dbPath: string) {
  const checkpointDirectory = join(dirname(dbPath), '.refora-agent', 'shared')
  mkdirSync(checkpointDirectory, { recursive: true, mode: 0o700 })
  const checkpointPath = join(checkpointDirectory, 'checkpoints.sqlite')
  const checkpointer = SqliteSaver.fromConnString(checkpointPath)
  let closed = false

  async function getHead(threadId: string): Promise<string | null> {
    const tuple = await checkpointer.getTuple({ configurable: { thread_id: threadId } })
    const checkpointId = tuple?.config?.configurable?.checkpoint_id
    return typeof checkpointId === 'string' ? checkpointId : null
  }

  async function deleteThread(threadId: string): Promise<void> {
    if (closed) return
    await checkpointer.deleteThread(threadId)
  }

  function close(): void {
    if (closed) return
    closed = true
    checkpointer.db.close()
  }

  return { checkpointer, checkpointPath, getHead, deleteThread, close }
}

export type AgentCheckpointService = ReturnType<typeof createAgentCheckpointService>
