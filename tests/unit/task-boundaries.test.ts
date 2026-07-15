import { describe, expect, it, vi } from 'vitest'
import { createExclusiveTask } from '../../src/main/services/exclusiveTask'
import { runMenuAction } from '../../src/main/services/menuAction'
import { prepareReplacement } from '../../src/main/services/resourceReplacement'

describe('exclusive task', () => {
  it('clears a failed task without creating a detached rejection', async () => {
    const perform = vi.fn()
      .mockRejectedValueOnce(new Error('switch failed'))
      .mockResolvedValueOnce('switched')
    const run = createExclusiveTask(perform, () => new Error('busy'))

    await expect(run()).rejects.toThrow('switch failed')
    await expect(run()).resolves.toBe('switched')
  })

  it('rejects concurrent work while the first task is active', async () => {
    let release: ((value: string) => void) | undefined
    const run = createExclusiveTask(
      () => new Promise<string>((resolve) => { release = resolve }),
      () => new Error('busy')
    )

    const first = run()
    await expect(run()).rejects.toThrow('busy')
    release?.('done')
    await expect(first).resolves.toBe('done')
  })
})

describe('menu action boundary', () => {
  it('reports synchronous and asynchronous action failures without rejecting', async () => {
    const onError = vi.fn()

    await expect(runMenuAction(() => { throw new Error('sync') }, onError)).resolves.toBeUndefined()
    await expect(runMenuAction(async () => { throw new Error('async') }, onError)).resolves.toBeUndefined()

    expect(onError).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: 'sync' }))
    expect(onError).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: 'async' }))
  })
})

describe('resource replacement', () => {
  it('disposes an unconfigured candidate without touching the current resource', () => {
    const current = { id: 'current' }
    const candidate = { id: 'candidate' }
    const dispose = vi.fn()

    expect(() => prepareReplacement(
      () => candidate,
      () => { throw new Error('cannot configure') },
      dispose
    )).toThrow('cannot configure')

    expect(dispose).toHaveBeenCalledWith(candidate)
    expect(dispose).not.toHaveBeenCalledWith(current)
  })
})
