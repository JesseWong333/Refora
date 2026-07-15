export function prepareReplacement<T>(
  prepare: () => T,
  configure: (candidate: T) => void,
  dispose: (candidate: T) => void
): T {
  const candidate = prepare()
  try {
    configure(candidate)
    return candidate
  } catch (error) {
    dispose(candidate)
    throw error
  }
}
