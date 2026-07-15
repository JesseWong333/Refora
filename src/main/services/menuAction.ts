export async function runMenuAction(
  action: () => void | Promise<void>,
  onError: (error: unknown) => void
): Promise<void> {
  try {
    await action()
  } catch (error) {
    try {
      onError(error)
    } catch {
      return
    }
  }
}
