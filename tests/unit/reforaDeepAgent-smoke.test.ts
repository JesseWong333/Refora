import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const python = process.env.REFORA_AGENT_PYTHON

describe('Refora Python Deep Agent package integration', () => {
  it('pins every migrated LangChain package in the Python project', () => {
    const project = readFileSync(resolve('python/agent/pyproject.toml'), 'utf8')
    const lock = readFileSync(resolve('python/agent/uv.lock'), 'utf8')
    expect(project).toContain('"deepagents==0.6.12"')
    expect(project).toContain('"langchain==1.3.14"')
    expect(project).toContain('"langchain-core==1.5.1"')
    expect(project).toContain('"langgraph==1.2.9"')
    expect(project).toContain('"langchain-openai==1.4.1"')
    expect(project).toContain('"langgraph-checkpoint-sqlite==3.1.0"')
    expect(lock).toContain('requires-python = "==3.12.*"')
    expect(lock).toContain('name = "deepagents"\nversion = "0.6.12"')
    expect(lock).toContain('name = "langchain"\nversion = "1.3.14"')
    expect(lock).toContain('name = "langchain-core"\nversion = "1.5.1"')
    expect(lock).toContain('name = "langgraph"\nversion = "1.2.9"')
    expect(lock).toContain('name = "langchain-openai"\nversion = "1.4.1"')
    expect(lock).toContain('name = "langgraph-checkpoint-sqlite"\nversion = "3.1.0"')
  })

  it.skipIf(!python)('constructs and invokes the real Python Deep Agents graph', () => {
    expect(() => execFileSync(
      python!,
      [resolve('python/agent/smoke_test.py')],
      { stdio: 'pipe' }
    )).not.toThrow()
  })
})
