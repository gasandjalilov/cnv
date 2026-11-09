import { useState } from 'react'
import type { DatabaseConnection, DatabaseDriver, DatabaseTable, DatabaseTableRows } from '@shared/database'

interface Props {
  onCancel(): void
  onImport(table: string, result: DatabaseTableRows): void
}

const DEFAULT_PORTS: Record<DatabaseDriver, number> = { sqlite: 0, postgres: 5432, mysql: 3306 }

export function DatabaseImportDialog({ onCancel, onImport }: Props): React.JSX.Element {
  const [driver, setDriver] = useState<DatabaseDriver>('sqlite')
  const [file, setFile] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState(DEFAULT_PORTS.postgres)
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [ssl, setSsl] = useState(false)
  const [tables, setTables] = useState<DatabaseTable[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState<'tables' | 'rows' | null>(null)
  const [error, setError] = useState('')

  const connection = (): DatabaseConnection => ({
    driver,
    ...(driver === 'sqlite' ? { file } : { host, port, database, user, password, ssl })
  })

  const changeDriver = (next: DatabaseDriver): void => {
    setDriver(next)
    if (next !== 'sqlite') setPort(DEFAULT_PORTS[next])
    setTables([])
    setSelected('')
    setError('')
  }

  const connect = async (): Promise<void> => {
    setBusy('tables')
    setError('')
    setTables([])
    setSelected('')
    try {
      const result = await window.api.database.tables(connection())
      setTables(result)
      if (result.length === 1) setSelected('0')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const importTable = async (): Promise<void> => {
    const table = tables[Number(selected)]
    if (!table) return
    setBusy('rows')
    setError('')
    try {
      const result = await window.api.database.rows(connection(), table)
      onImport(table.schema ? `${table.schema}.${table.name}` : table.name, result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog dialog--wide connector-dialog" role="dialog" data-testid="database-import">
        <div className="dialog__title">Импорт из базы данных</div>
        <div className="settings__row">
          <label htmlFor="database-driver">Драйвер</label>
          <select
            id="database-driver"
            data-testid="database-driver"
            value={driver}
            disabled={busy !== null}
            onChange={(e) => changeDriver(e.target.value as DatabaseDriver)}
          >
            <option value="sqlite">SQLite</option>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL / MariaDB</option>
          </select>
        </div>
        {driver === 'sqlite' ? (
          <div className="settings__row">
            <label htmlFor="database-file">Файл базы</label>
            <div className="database-import__file">
              <input
                id="database-file"
                data-testid="database-file"
                value={file}
                placeholder="/path/to/database.db"
                onChange={(e) => setFile(e.target.value)}
              />
              <button
                type="button"
                data-testid="database-choose-file"
                onClick={() =>
                  void window.api.files
                    .choose([{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }])
                    .then(([chosen]) => chosen && setFile(chosen))
                }
              >
                Выбрать…
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="settings__row">
              <label htmlFor="database-host">Хост</label>
              <input id="database-host" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="settings__row">
              <label htmlFor="database-port">Порт</label>
              <input
                id="database-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </div>
            <div className="settings__row">
              <label htmlFor="database-name">База данных</label>
              <input id="database-name" value={database} onChange={(e) => setDatabase(e.target.value)} />
            </div>
            <div className="settings__row">
              <label htmlFor="database-user">Пользователь</label>
              <input id="database-user" value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
            <div className="settings__row">
              <label htmlFor="database-password">Пароль</label>
              <input
                id="database-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="settings__row">
              <label htmlFor="database-ssl">SSL</label>
              <input
                id="database-ssl"
                type="checkbox"
                checked={ssl}
                onChange={(e) => setSsl(e.target.checked)}
              />
            </div>
          </>
        )}
        <div className="database-import__actions">
          <button
            type="button"
            data-testid="database-connect"
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            {busy === 'tables' ? 'Подключение…' : 'Показать таблицы'}
          </button>
        </div>
        {tables.length > 0 && (
          <div className="settings__row">
            <label htmlFor="database-table">Таблица</label>
            <select
              id="database-table"
              data-testid="database-table"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Выберите таблицу…</option>
              {tables.map((table, index) => (
                <option key={`${table.schema ?? ''}.${table.name}`} value={index}>
                  {table.schema ? `${table.schema}.${table.name}` : table.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {tables.length === 0 && !error && (
          <div className="database-import__hint">Импортируются первые 500 строк.</div>
        )}
        {error && (
          <div className="database-import__error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog__buttons">
          <button type="button" disabled={busy !== null} onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            data-testid="database-import-submit"
            disabled={!selected || busy !== null}
            onClick={() => void importTable()}
          >
            {busy === 'rows' ? 'Импорт…' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  )
}
