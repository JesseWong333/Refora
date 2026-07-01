export class RepoError extends Error {
  readonly code: string
  readonly field?: string

  constructor(code: string, message: string, field?: string) {
    super(message)
    this.name = 'RepoError'
    this.code = code
    this.field = field
  }
}
