export function createExclusiveTask<TArgs extends unknown[], TResult>(
  perform: (...args: TArgs) => Promise<TResult>,
  busyError: () => Error
): (...args: TArgs) => Promise<TResult> {
  let active: Promise<TResult> | null = null

  return async (...args: TArgs): Promise<TResult> => {
    if (active) throw busyError()
    const work = Promise.resolve().then(() => perform(...args))
    active = work
    try {
      return await work
    } finally {
      if (active === work) active = null
    }
  }
}
