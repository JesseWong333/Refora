import { z, type ZodType } from 'zod'

export interface AgentHostTool {
  name: string
  description: string
  schema: ZodType
  jsonSchema: Record<string, unknown>
  func: (input: never) => Promise<string> | string
  invoke(input: unknown): Promise<string>
}

interface StructuredHostToolInput<T> {
  name: string
  description: string
  schema: ZodType<T>
  func: (input: T) => Promise<string> | string
}

interface StringHostToolInput {
  name: string
  description: string
  argumentName?: string
  func: (input: string) => Promise<string> | string
}

function stringifyResult(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function createAgentStructuredHostTool<T>(
  input: StructuredHostToolInput<T>
): AgentHostTool {
  return {
    name: input.name,
    description: input.description,
    schema: input.schema,
    jsonSchema: z.toJSONSchema(input.schema) as Record<string, unknown>,
    func: input.func as (input: never) => Promise<string> | string,
    async invoke(value: unknown): Promise<string> {
      return stringifyResult(await input.func(input.schema.parse(value)))
    }
  }
}

export function createAgentStringHostTool(input: StringHostToolInput): AgentHostTool {
  const argumentName = input.argumentName ?? 'input'
  const schema = z.object({ [argumentName]: z.string() })
  return {
    name: input.name,
    description: input.description,
    schema,
    jsonSchema: {
      type: 'object',
      properties: {
        [argumentName]: { type: 'string' }
      },
      required: [argumentName],
      additionalProperties: false
    },
    func: input.func as (input: never) => Promise<string> | string,
    async invoke(value: unknown): Promise<string> {
      if (typeof value === 'string') return stringifyResult(await input.func(value))
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${input.name} requires a string argument`)
      }
      const candidate = Reflect.get(value, argumentName)
      if (typeof candidate !== 'string') {
        throw new Error(`${input.name} requires ${argumentName} to be a string`)
      }
      return stringifyResult(await input.func(candidate))
    }
  }
}
