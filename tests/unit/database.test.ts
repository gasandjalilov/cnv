import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { listDatabaseTables, readDatabaseTable } from '../../src/main/database'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'cnv-database-'))
  file = path.join(dir, 'test.db')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function createDatabase(sql: string): void {
  const db = new DatabaseSync(file)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

describe('подключение к базе данных', () => {
  it('SQLite: показывает таблицы и импортирует выбранную в read-only режиме', async () => {
    createDatabase(`
      CREATE TABLE "release tests" (name TEXT, seconds REAL, passed INTEGER, note TEXT, payload BLOB);
      INSERT INTO "release tests" VALUES ('login', 12.4, 1, NULL, x'ff00');
      CREATE VIEW release_view AS SELECT name FROM "release tests";
    `)
    const connection = { driver: 'sqlite', file } as const

    await expect(listDatabaseTables(connection)).resolves.toEqual([
      { name: 'release tests' },
      { name: 'release_view' }
    ])
    await expect(readDatabaseTable(connection, { name: 'release tests' })).resolves.toEqual({
      rows: [{ name: 'login', seconds: 12.4, passed: 1, note: null, payload: 'ff00' }],
      truncated: false
    })
    await expect(readDatabaseTable(connection, { name: 'missing' })).rejects.toThrow('no such table')
  })

  it('SQLite: экранирует кавычки в имени таблицы', async () => {
    createDatabase('CREATE TABLE "odd ""table""" (value INTEGER); INSERT INTO "odd ""table""" VALUES (42);')
    await expect(readDatabaseTable({ driver: 'sqlite', file }, { name: 'odd "table"' })).resolves.toEqual({
      rows: [{ value: 42 }],
      truncated: false
    })
  })

  it('импортирует не больше 500 строк и сообщает об ограничении', async () => {
    createDatabase(`
      CREATE TABLE numbers (value INTEGER);
      WITH RECURSIVE cnt(x) AS (
        SELECT 1 UNION ALL SELECT x + 1 FROM cnt WHERE x < 501
      ) INSERT INTO numbers SELECT x FROM cnt;
    `)
    const result = await readDatabaseTable({ driver: 'sqlite', file }, { name: 'numbers' })
    expect(result.rows).toHaveLength(500)
    expect(result.rows[0]).toEqual({ value: 1 })
    expect(result.rows[499]).toEqual({ value: 500 })
    expect(result.truncated).toBe(true)
  })

  it('проверяет обязательные параметры', async () => {
    await expect(listDatabaseTables({ driver: 'sqlite', file: '' })).rejects.toThrow('файл SQLite')
    await expect(listDatabaseTables({ driver: 'postgres', host: '' })).rejects.toThrow('хост')
  })
})
