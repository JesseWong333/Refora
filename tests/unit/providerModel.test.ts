import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { ChatGenerationChunk } from '@langchain/core/outputs'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  buildProviderReasoningOptions,
  createProviderChatModel
} from '../../src/main/services/providerModel'
import type { AiProvider } from '../../src/shared/ipc-types'

const openAiProvider: AiProvider = {
  id: 'provider-openai',
  presetId: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiProtocol: 'openai-responses',
  reasoningControl: 'openai',
  reasoningEffort: 'high',
  model: 'gpt-5.6-terra',
  baseModel: 'gpt-5.6-terra',
  variant: '',
  variantFormat: 'none',
  hasKey: true,
  temperature: null,
  maxTokens: null,
  createdAt: 1
}

const compatibleProvider: AiProvider = {
  ...openAiProvider,
  id: 'provider-compatible',
  presetId: 'custom',
  name: 'Compatible provider',
  baseUrl: 'https://compatible.invalid/v1',
  apiProtocol: 'openai-compatible',
  model: 'xopkimik26',
  baseModel: 'xopkimik26'
}

describe('provider reasoning request options', () => {
  it('uses Responses reasoning for OpenAI', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'openai',
          apiProtocol: 'openai-responses',
          reasoningControl: 'openai',
          reasoningEffort: 'high'
        },
        true
      )
    ).toEqual({
      useResponsesApi: true,
      modelKwargs: {},
      reasoning: { effort: 'high', summary: 'auto' }
    })
  })

  it('uses thinking.type for Kimi, DeepSeek, and GLM compatible APIs', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'deepseek',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'max'
        },
        true
      ).modelKwargs
    ).toEqual({ thinking: { type: 'enabled' }, reasoning_effort: 'max' })

    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'kimi',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'high'
        },
        true
      ).modelKwargs
    ).toEqual({ thinking: { type: 'enabled' } })

    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'deepseek',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'thinking',
          reasoningEffort: 'high'
        },
        false
      ).modelKwargs
    ).toEqual({ thinking: { type: 'disabled' } })
  })

  it('uses enable_thinking for Qwen compatible APIs', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'qwen',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'enable-thinking',
          reasoningEffort: 'high'
        },
        true
      ).modelKwargs
    ).toEqual({ enable_thinking: true })
  })

  it('uses the unified reasoning request for OpenRouter', () => {
    expect(
      buildProviderReasoningOptions(
        {
          presetId: 'openrouter',
          apiProtocol: 'openai-compatible',
          reasoningControl: 'openai',
          reasoningEffort: 'high'
        },
        true
      ).modelKwargs
    ).toEqual({ reasoning: { effort: 'high' } })
  })

  it('does not send reasoning parameters to a non-reasoning model', () => {
    const model = createProviderChatModel({
      provider: { ...openAiProvider, model: 'gpt-4o-mini' },
      apiKey: 'test-key',
      streaming: false,
      deepThinking: true
    })

    expect(model.useResponsesApi).toBe(true)
    expect(model.modelKwargs).toEqual({})
    expect(model.reasoning).toBeUndefined()
  })

  it('uses the per-chat reasoning effort instead of the provider default', () => {
    const model = createProviderChatModel({
      provider: openAiProvider,
      apiKey: 'test-key',
      streaming: false,
      deepThinking: true,
      reasoningEffort: 'low'
    })

    expect(model.reasoning).toEqual({ effort: 'low', summary: 'auto' })
  })

  it('treats roleless compatible streaming deltas as assistant output', async () => {
    const model = createProviderChatModel({
      provider: compatibleProvider,
      apiKey: 'test-key',
      streaming: true,
      deepThinking: false
    })
    const completionWithRetry = vi.fn(async () => (async function* () {
      yield {
        id: 'completion-1',
        model: 'xopkimik26',
        choices: [{
          index: 0,
          delta: { reasoning: 'Inspect ' }
        }]
      }
      yield {
        id: 'completion-1',
        model: 'xopkimik26',
        choices: [{
          index: 0,
          delta: {
            reasoning_details: [
              { type: 'reasoning.encrypted', data: 'hidden' },
              { type: 'reasoning.text', text: 'sources. ' }
            ]
          }
        }]
      }
      yield {
        id: 'completion-1',
        model: 'xopkimik26',
        choices: [{
          index: 0,
          delta: { thinking: 'Use OCR. ' }
        }]
      }
      yield {
        id: 'completion-1',
        model: 'xopkimik26',
        choices: [{
          index: 0,
          delta: { content: 'Checking OCR cache. ' }
        }]
      }
      yield {
        id: 'completion-1',
        model: 'xopkimik26',
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call-1',
              type: 'function',
              function: {
                name: 'read_paper_ocr_fulltext',
                arguments: '{"docId":"doc-1"}'
              }
            }]
          },
          finish_reason: 'tool_calls'
        }]
      }
    })())
    const readOcr = new DynamicStructuredTool({
      name: 'read_paper_ocr_fulltext',
      description: 'Read OCR cache',
      schema: z.object({ docId: z.string() }),
      func: async () => ''
    })

    const boundModel = model.bindTools([readOcr])
    const boundInternals = boundModel as unknown as {
      completions?: {
        completionWithRetry: typeof completionWithRetry
        _streamResponseChunks: (
          messages: HumanMessage[],
          options: Record<string, unknown>
        ) => AsyncGenerator<ChatGenerationChunk>
      }
      bound?: {
        completions?: {
          completionWithRetry: typeof completionWithRetry
          _streamResponseChunks: (
            messages: HumanMessage[],
            options: Record<string, unknown>
          ) => AsyncGenerator<ChatGenerationChunk>
        }
      }
    }
    const completions = boundInternals.completions ?? boundInternals.bound?.completions
    expect(completions).toBeDefined()
    if (!completions) throw new Error('Bound completions model is unavailable')
    completions.completionWithRetry = completionWithRetry

    const chunks: ChatGenerationChunk[] = []
    for await (const chunk of completions._streamResponseChunks(
      [new HumanMessage('Check OCR cache.')],
      {}
    )) {
      chunks.push(chunk)
    }
    const result = chunks.reduce((combined, chunk) => combined.concat(chunk)).message

    expect(completionWithRetry).toHaveBeenCalledTimes(1)
    expect(AIMessage.isInstance(result)).toBe(true)
    expect(result.content).toBe('Checking OCR cache. ')
    expect(result.additional_kwargs.reasoning_content).toBe('Inspect sources. Use OCR. ')
    expect(result.tool_calls).toEqual([{
      name: 'read_paper_ocr_fulltext',
      args: { docId: 'doc-1' },
      id: 'call-1',
      type: 'tool_call'
    }])
  })
})
