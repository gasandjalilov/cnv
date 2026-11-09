import { useState } from 'react'
import type { KanbanConnection, KanbanImportResult, KanbanProvider, KanbanSource } from '@shared/kanban'

interface Props {
  onCancel(): void
  onImport(result: KanbanImportResult): void
}

export function KanbanImportDialog({ onCancel, onImport }: Props): React.JSX.Element {
  const [provider, setProvider] = useState<KanbanProvider>('jira')
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [sources, setSources] = useState<KanbanSource[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState<'sources' | 'board' | null>(null)
  const [error, setError] = useState('')

  const connection = (): KanbanConnection => ({ provider, url, email, token })

  const connect = async (): Promise<void> => {
    setBusy('sources')
    setError('')
    setSources([])
    setSelected('')
    try {
      const result = await window.api.kanban.sources(connection())
      setSources(result)
      if (result.length === 1) setSelected('0')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const importBoard = async (): Promise<void> => {
    const source = sources[Number(selected)]
    if (!source) return
    setBusy('board')
    setError('')
    try {
      onImport(await window.api.kanban.import(connection(), source))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog dialog--wide connector-dialog" role="dialog" data-testid="kanban-import">
        <div className="dialog__title">Импорт канбан-доски</div>
        <div className="settings__row">
          <label htmlFor="kanban-provider">Сервис</label>
          <select
            id="kanban-provider"
            data-testid="kanban-provider"
            value={provider}
            disabled={busy !== null}
            onChange={(e) => {
              setProvider(e.target.value as KanbanProvider)
              setSources([])
              setSelected('')
              setError('')
            }}
          >
            <option value="jira">Jira</option>
            <option value="kaiten">Kaiten</option>
          </select>
        </div>
        <div className="settings__row">
          <label htmlFor="kanban-url">Адрес</label>
          <input
            id="kanban-url"
            data-testid="kanban-url"
            value={url}
            placeholder={provider === 'jira' ? 'https://company.atlassian.net' : 'https://company.kaiten.ru'}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        {provider === 'jira' && (
          <div className="settings__row">
            <label htmlFor="kanban-email">Email</label>
            <input
              id="kanban-email"
              data-testid="kanban-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}
        <div className="settings__row">
          <label htmlFor="kanban-token">API-токен</label>
          <input
            id="kanban-token"
            data-testid="kanban-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div className="connector-dialog__actions">
          <button
            type="button"
            data-testid="kanban-connect"
            disabled={busy !== null}
            onClick={() => void connect()}
          >
            {busy === 'sources'
              ? 'Подключение…'
              : provider === 'jira'
                ? 'Показать проекты'
                : 'Показать доски'}
          </button>
        </div>
        {sources.length > 0 && (
          <div className="settings__row">
            <label htmlFor="kanban-source">{provider === 'jira' ? 'Проект' : 'Доска'}</label>
            <select
              id="kanban-source"
              data-testid="kanban-source"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{provider === 'jira' ? 'Выберите проект…' : 'Выберите доску…'}</option>
              {sources.map((source, index) => (
                <option key={`${source.id}:${source.subtitle ?? ''}`} value={index}>
                  {source.title}
                  {source.subtitle ? ` — ${source.subtitle}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {!error && (
          <div className="connector-dialog__hint">
            Одноразовый импорт до 500 карточек. Токен не сохраняется.
          </div>
        )}
        {error && (
          <div className="connector-dialog__error" role="alert">
            {error}
          </div>
        )}
        <div className="dialog__buttons">
          <button type="button" disabled={busy !== null} onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            data-testid="kanban-import-submit"
            disabled={!selected || busy !== null}
            onClick={() => void importBoard()}
          >
            {busy === 'board' ? 'Импорт…' : 'Импортировать'}
          </button>
        </div>
      </div>
    </div>
  )
}
