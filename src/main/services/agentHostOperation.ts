export interface AgentHostOperation {
  name: string
  invoke(input: unknown): Promise<string>
}

type DynamicHostInput = ReturnType<typeof JSON.parse>

interface StructuredHostOperationInput {
  name: string
  func: (input: DynamicHostInput) => Promise<string> | string
}

interface StringHostOperationInput {
  name: string
  argumentName?: string
  func: (input: string) => Promise<string> | string
}

function stringifyResult(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function createStructuredHostOperation(
  input: StructuredHostOperationInput
): AgentHostOperation {
  return {
    name: input.name,
    async invoke(value: unknown): Promise<string> {
      return stringifyResult(await input.func(value))
    }
  }
}

export function createStringHostOperation(
  input: StringHostOperationInput
): AgentHostOperation {
  const argumentName = input.argumentName ?? 'input'
  return {
    name: input.name,
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
