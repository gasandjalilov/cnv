import { DatabaseSync } from 'node:sqlite'
import { Client } from 'pg'
import mysql from 'mysql2/promise'
import { DATA_MAX_ROWS, normalizeDataSpec, type DataCell } from '@core/data'
import type { DatabaseConnection, DatabaseTable, DatabaseTableRows } from '@shared/database'

export class DatabaseError extends Error {}

const quoteDouble = (value: string): string => `"${value.replace(/"/g, '""')}"`
const quoteBacktick = (value: string): string => `\`${value.replace(/`/g, '``')}\``

function required(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new DatabaseError(`укажите ${label}`)
  return trimmed
}

function cell(value: unknown): DataCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function tableRows(rows: Record<string, unknown>[]): DatabaseTableRows {
  const truncated = rows.length > DATA_MAX_ROWS
  const values = rows
    .slice(0, DATA_MAX_ROWS)
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, cell(value)])))
  return { rows: normalizeDataSpec({ rows: values }).rows, truncated }
}

async function sqlite<T>(connection: DatabaseConnection, run: (db: DatabaseSync) => T): Promise<T> {
  const db = new DatabaseSync(required(connection.file, 'файл SQLite'), { readOnly: true })
  try {
    return run(db)
  } finally {
    db.close()
  }
}

async function postgres<T>(connection: DatabaseConnection, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: required(connection.host, 'хост'),
    port: connection.port ?? 5432,
    database: required(connection.database, 'базу данных'),
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ? { rejectUnauthorized: true } : undefined,
    connectionTimeoutMillis: 10000,
    query_timeout: 30000
  })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

async function withMysql<T>(
  connection: DatabaseConnection,
  run: (client: mysql.Connection) => Promise<T>
): Promise<T> {
  const client = await mysql.createConnection({
    host: required(connection.host, 'хост'),
    port: connection.port ?? 3306,
    database: required(connection.database, 'базу данных'),
    user: connection.user,
    password: connection.password,
    ssl: connection.ssl ? {} : undefined,
    connectTimeout: 10000
  })
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export async function listDatabaseTables(connection: DatabaseConnection): Promise<DatabaseTable[]> {
  switch (connection.driver) {
    case 'sqlite':
      return sqlite(connection, (db) =>
        (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
            .all() as { name: string }[]
        ).map((row) => ({ name: row.name }))
      )
    case 'postgres':
      return postgres(connection, async (client) => {
        const result = await client.query<{ table_schema: string; table_name: string }>(
          "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type IN ('BASE TABLE', 'VIEW') AND table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name"
        )
        return result.rows.map((row) => ({ schema: row.table_schema, name: row.table_name }))
      })
    case 'mysql':
      return withMysql(connection, async (client) => {
        const [rows] = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name"
        )
        return (rows as { table_name: string }[]).map((row) => ({ name: row.table_name }))
      })
    default:
      throw new DatabaseError('неизвестный драйвер базы данных')
  }
}

function validateTable(table: DatabaseTable): DatabaseTable {
  const name = required(table?.name, 'таблицу')
  const schema = table.schema?.trim()
  return { name, ...(schema ? { schema } : {}) }
}

export async function readDatabaseTable(
  connection: DatabaseConnection,
  input: DatabaseTable
): Promise<DatabaseTableRows> {
  const table = validateTable(input)
  const limit = DATA_MAX_ROWS + 1
  switch (connection.driver) {
    case 'sqlite':
      return sqlite(connection, (db) =>
        tableRows(
          db.prepare(`SELECT * FROM ${quoteDouble(table.name)} LIMIT ${limit}`).all() as Record<
            string,
            unknown
          >[]
        )
      )
    case 'postgres':
      return postgres(connection, async (client) => {
        const identifier = table.schema
          ? `${quoteDouble(table.schema)}.${quoteDouble(table.name)}`
          : quoteDouble(table.name)
        const result = await client.query(`SELECT * FROM ${identifier} LIMIT ${limit}`)
        return tableRows(result.rows)
      })
    case 'mysql':
      return withMysql(connection, async (client) => {
        const [rows] = await client.query(`SELECT * FROM ${quoteBacktick(table.name)} LIMIT ${limit}`)
        return tableRows(rows as Record<string, unknown>[])
      })
    default:
      throw new DatabaseError('неизвестный драйвер базы данных')
  }
}
