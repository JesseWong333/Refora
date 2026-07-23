import { ToolMessage } from '@langchain/core/messages'
import { createMiddleware } from 'langchain'
import type { Repositories } from '../db/repositories'

const IDEMPOTENT_TOOL_NAMES = new Set([
  'generate_report',
  'add_docs_to_workspace',
  'create_workspace_connections',
  'publish_workspace_artifacts',
  'install_runtime_packages',
  'propose_workspace_memory_update'
])

function resultText(result: unknown): string {
  if (result instanceof ToolMessage) {
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  }
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

export function createReforaAgentPolicyMiddleware(input: {
  repos: Repositories
  runId: string
  workspaceId: string | null
}) {
  return createMiddleware({
    name: 'ReforaAgentPolicyMiddleware',
    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name
      const toolCallId = request.toolCall.id
      if (!IDEMPOTENT_TOOL_NAMES.has(toolName) || !toolCallId) {
        return handler(request)
      }
      const existing = input.repos.agentToolEffects.get(input.runId, toolCallId)
      if (existing?.status === 'done' && existing.result !== null) {
        return new ToolMessage({
          name: toolName,
          tool_call_id: toolCallId,
          content: existing.result
        })
      }
      if (existing?.status === 'running') {
        return new ToolMessage({
          name: toolName,
          tool_call_id: toolCallId,
          content: JSON.stringify({
            error: 'This tool call has an unknown outcome from an interrupted run. Inspect the Workspace before trying a new operation.'
          })
        })
      }
      input.repos.agentToolEffects.begin({
        runId: input.runId,
        toolCallId,
        toolName,
        workspaceId: input.workspaceId
      })
      try {
        const result = await handler(request)
        input.repos.agentToolEffects.finish(
          input.runId,
          toolCallId,
          'done',
          resultText(result)
        )
        return result
      } catch (error) {
        input.repos.agentToolEffects.finish(
          input.runId,
          toolCallId,
          'error',
          error instanceof Error ? error.message : String(error)
        )
        throw error
      }
    }
  })
}
