import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_PYTHON_RUNTIME_VERSION,
  createAgentPythonRuntime
} from '../../src/main/services/agentPythonRuntime'

describe('Agent Python runtime', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function fixture(script: string) {
    const userDataDir = await mkdtemp(join(tmpdir(), 'refora-agent-python-test-'))
    roots.push(userDataDir)
    const root = join(
      userDataDir,
      'agent-python',
      AGENT_PYTHON_RUNTIME_VERSION,
      'darwin-arm64'
    )
    const python = join(root, 'runtime', 'venv', 'bin', 'python')
    await mkdir(join(root, 'runtime', 'venv', 'bin'), { recursive: true })
    await writeFile(python, script)
    await chmod(python, 0o755)
    const workerScriptPath = join(userDataDir, 'worker.py')
    const projectPath = join(userDataDir, 'pyproject.toml')
    const lockPath = join(userDataDir, 'uv.lock')
    await writeFile(workerScriptPath, '')
    await writeFile(projectPath, '')
    await writeFile(lockPath, 'test lock')
    const lockSha256 = createHash('sha256').update('test lock').digest('hex')
    await writeFile(join(root, 'installed-manifest.json'), JSON.stringify({
      runtimeVersion: AGENT_PYTHON_RUNTIME_VERSION,
      architecture: 'arm64',
      pythonVersion: '3.12.13',
      pythonRelativePath: 'runtime/venv/bin/python',
      lockSha256,
      packages: {
        deepagents: '0.6.12',
        langchain: '1.3.14',
        'langchain-core': '1.5.1',
        langgraph: '1.2.9',
        'langchain-openai': '1.4.1',
        'langgraph-checkpoint-sqlite': '3.1.0'
      },
      installedAt: 1
    }))
    return createAgentPythonRuntime({
      userDataDir,
      workerScriptPath,
      projectPath,
      architecture: 'arm64',
      downloadFile: vi.fn()
    })
  }

  it('streams Python events and services host tool requests over stdio', async () => {
    const runtime = await fixture(
      '#!/bin/sh\n' +
      'read request\n' +
      'printf \'%s\\n\' \'{"type":"event","event":{"event":"on_tool_start","name":"search_library","data":{"input":{"query":"agents"}}}}\'\n' +
      'printf \'%s\\n\' \'{"type":"tool_request","id":"tool-1","name":"search_library","arguments":{"query":"agents"},"toolCallId":"call-1"}\'\n' +
      'read response\n' +
      'printf \'%s\\n\' \'{"type":"complete","result":{"messages":[]},"state":{"config":{"configurable":{"checkpoint_id":"cp-1"}},"values":{},"tasks":[]}}\'\n'
    )
    const executeTool = vi.fn(async () => '[]')
    const completions: unknown[] = []
    const events = []
    for await (const event of runtime.stream({
      mode: 'run',
      runId: 'run-1',
      threadId: 'thread-1',
      workspaceId: null,
      checkpointPath: '/tmp/checkpoint.sqlite',
      checkpointBefore: null,
      provider: {
        model: 'model',
        baseUrl: 'https://example.test',
        apiKey: 'key',
        useResponsesApi: false,
        modelKwargs: {},
        temperature: null,
        maxTokens: null
      },
      systemPrompt: 'prompt',
      messages: [{ role: 'user', content: 'hello' }],
      enabledToolNames: [],
      sandboxRoot: null,
      memories: {},
      includeResearchMemory: false,
      recursionLimit: 50
    }, {
      executeTool,
      onComplete: (completion) => completions.push(completion)
    }, new AbortController().signal)) {
      events.push(event)
    }

    expect(events).toEqual([{
      event: 'on_tool_start',
      name: 'search_library',
      data: { input: { query: 'agents' } }
    }])
    expect(executeTool).toHaveBeenCalledWith(
      'search_library',
      { query: 'agents' },
      'call-1'
    )
    expect(completions).toEqual([{
      result: { messages: [] },
      state: {
        config: { configurable: { checkpoint_id: 'cp-1' } },
        values: {},
        tasks: []
      }
    }])
  })

  it('runs summary and title jobs through the same managed Python worker', async () => {
    const summaryRuntime = await fixture(
      '#!/bin/sh\n' +
      'read request\n' +
      'printf \'%s\\n\' \'{"type":"complete","result":{"core":"Summary","keyPoints":["one"]},"state":{}}\'\n'
    )
    const provider = {
      model: 'model',
      baseUrl: 'https://example.test',
      apiKey: 'key',
      useResponsesApi: false,
      modelKwargs: {},
      temperature: null,
      maxTokens: 450
    }
    await expect(summaryRuntime.generateSummary(
      { provider, text: 'paper text' },
      new AbortController().signal
    )).resolves.toEqual({ core: 'Summary', keyPoints: ['one'] })

    const titleRuntime = await fixture(
      '#!/bin/sh\n' +
      'read request\n' +
      'printf \'%s\\n\' \'{"type":"complete","result":"Research Title","state":{}}\'\n'
    )
    await expect(titleRuntime.generateTitle(
      {
        provider: { ...provider, maxTokens: 30 },
        userMessage: 'question',
        reasoningModel: false
      },
      new AbortController().signal
    )).resolves.toBe('Research Title')
  })
})
