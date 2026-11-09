import type { DataRow } from '@core/data'

export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql'

export interface DatabaseConnection {
  driver: DatabaseDriver
  file?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean
}

export interface DatabaseTable {
  name: string
  schema?: string
}

export interface DatabaseTableRows {
  rows: DataRow[]
  truncated: boolean
}
