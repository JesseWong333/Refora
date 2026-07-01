export interface SqliteStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface SqliteDb {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}
