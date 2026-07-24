import type { Repositories } from '../db/repositories'
import type { AgentHostTool } from './agentHostTool'

const IDEMPOTENT_TOOL_NAMES = new Set([
  'generate_report',
  'add_docs_to_workspace',
  'create_workspace_connections',
  'publish_workspace_artifacts',
  'install_runtime_packages',
  'propose_workspace_memory_update'
])

export function createAgentToolExecutor(input: {
  repos: Repositories
  runId: string
  workspaceId: string | null
  tools: AgentHostTool[]
}) {
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]))

  return async (
    name: string,
    args: Record<string, unknown>,
    toolCallId: string | null
  ): Promise<string> => {
    const tool = tools.get(name)
    if (!tool) throw new Error(`Unknown Agent tool: ${name}`)
    if (!IDEMPOTENT_TOOL_NAMES.has(name) || !toolCallId) {
      return tool.invoke(args)
    }
    const existing = input.repos.agentToolEffects.get(input.runId, toolCallId)
    if (existing?.status === 'done' && existing.result !== null) return existing.result
    if (existing?.status === 'running') {
      return JSON.stringify({
        error:
          'This tool call has an unknown outcome from an interrupted run. Inspect the Workspace before trying a new operation.'
      })
    }
    input.repos.agentToolEffects.begin({
      runId: input.runId,
      toolCallId,
      toolName: name,
      workspaceId: input.workspaceId
    })
    try {
      const result = await tool.invoke(args)
      input.repos.agentToolEffects.finish(input.runId, toolCallId, 'done', result)
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
}
