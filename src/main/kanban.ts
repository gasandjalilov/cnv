import { newId } from '@core/document'
import type { BoardCard, BoardLane } from '@core/board'
import type { KanbanConnection, KanbanImportResult, KanbanSource } from '@shared/kanban'

const MAX_CARDS = 500
const PAGE_SIZE = 100
const DESCRIPTION_SIZE = 4000

export class KanbanError extends Error {}

type JsonObject = Record<string, unknown>

const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' ? (value as JsonObject) : {}
const array = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.map(object) : [])
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const number = (value: unknown): number => (typeof value === 'number' ? value : Number(value))

function baseUrl(connection: KanbanConnection): string {
  const raw = connection.url.trim().replace(/\/+$/, '')
  const url = new URL(raw)
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new KanbanError('адрес должен начинаться с http:// или https://')
  return raw
}

function headers(connection: KanbanConnection): Record<string, string> {
  if (!connection.token.trim()) throw new KanbanError('укажите API-токен')
  if (connection.provider === 'jira') {
    if (!connection.email?.trim()) throw new KanbanError('укажите email для Jira')
    return {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${connection.email.trim()}:${connection.token}`).toString('base64')}`
    }
  }
  return { accept: 'application/json', authorization: `Bearer ${connection.token}` }
}

async function request(
  connection: KanbanConnection,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: JsonObject } = {}
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${baseUrl(connection)}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...headers(connection),
        ...(init.body ? { 'content-type': 'application/json' } : {})
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(20000)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const safe = connection.token ? message.replaceAll(connection.token, '•••') : message
    throw new KanbanError(`не удалось подключиться: ${safe}`)
  }
  const body = await response.text()
  if (!response.ok) {
    let message = ''
    try {
      const parsed = object(JSON.parse(body))
      const messages = Array.isArray(parsed.errorMessages) ? parsed.errorMessages.join('; ') : ''
      message =
        text(parsed.message) || text(parsed.error) || text(parsed.detail) || messages || text(parsed.title)
    } catch {
      message = body
    }
    const safe = connection.token ? message.replaceAll(connection.token, '•••') : message
    throw new KanbanError(`${response.status} ${response.statusText}${safe ? `: ${safe.slice(0, 500)}` : ''}`)
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new KanbanError('сервис вернул не JSON')
  }
}

function inline(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function adfText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(adfText).join('')
  if (!value || typeof value !== 'object') return ''
  const node = object(value)
  const own =
    node.type === 'text' ? text(node.text) : node.type === 'hardBreak' ? '\n' : adfText(node.content)
  return ['paragraph', 'heading'].includes(text(node.type)) ? `${own}\n\n` : own
}

function card(textLines: { title: string; description?: unknown; meta?: string[] }): BoardCard {
  const description = adfText(textLines.description)
    .trim()
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, DESCRIPTION_SIZE)
  const meta = (textLines.meta ?? []).filter(Boolean)
  return {
    id: newId(),
    text: [
      `**${inline(textLines.title)}**`,
      ...(description ? ['', description] : []),
      ...(meta.length ? ['', `_${meta.join(' · ')}_`] : [])
    ].join('\n')
  }
}

async function jiraSources(connection: KanbanConnection): Promise<KanbanSource[]> {
  const sources: KanbanSource[] = []
  let startAt = 0
  while (sources.length < MAX_CARDS) {
    const result = object(
      await request(connection, `/rest/api/3/project/search?maxResults=${PAGE_SIZE}&startAt=${startAt}`)
    )
    const values = array(result.values).map((project) => ({
      id: text(project.key),
      title: text(project.name) || text(project.key),
      subtitle: text(project.key)
    }))
    sources.push(...values)
    startAt += values.length
    if (result.isLast === true || !values.length || startAt >= number(result.total)) break
  }
  return sources
}

interface JiraStatus {
  name: string
  category: number
  first: number
  cards: BoardCard[]
}

async function jiraImport(connection: KanbanConnection, source: KanbanSource): Promise<KanbanImportResult> {
  const key = source.id.trim()
  if (!key) throw new KanbanError('выберите проект Jira')
  const issues: JsonObject[] = []
  let nextPageToken = ''
  while (issues.length <= MAX_CARDS) {
    const result = object(
      await request(connection, '/rest/api/3/search/jql', {
        method: 'POST',
        body: {
          jql: `project = "${key.replace(/["\\]/g, '\\$&')}" ORDER BY created ASC`,
          fields: ['summary', 'status', 'description', 'assignee', 'priority'],
          maxResults: Math.min(PAGE_SIZE, MAX_CARDS + 1 - issues.length),
          ...(nextPageToken ? { nextPageToken } : {})
        }
      })
    )
    const page = array(result.issues)
    issues.push(...page)
    nextPageToken = text(result.nextPageToken)
    if (result.isLast === true || !page.length || !nextPageToken) break
  }
  const statuses = new Map<string, JiraStatus>()
  for (const issue of issues.slice(0, MAX_CARDS)) {
    const fields = object(issue.fields)
    const status = object(fields.status)
    const name = text(status.name) || 'Без статуса'
    let lane = statuses.get(name)
    if (!lane) {
      lane = { name, category: number(object(status.statusCategory).id), first: statuses.size, cards: [] }
      statuses.set(name, lane)
    }
    lane.cards.push(
      card({
        title: `${text(issue.key)} · ${text(fields.summary) || 'Без названия'}`,
        description: fields.description,
        meta: [
          text(object(fields.assignee).displayName) &&
            `Исполнитель: ${text(object(fields.assignee).displayName)}`,
          text(object(fields.priority).name) && `Приоритет: ${text(object(fields.priority).name)}`
        ]
      })
    )
  }
  const categoryOrder = (category: number): number =>
    category === 2 ? 0 : category === 4 ? 1 : category === 3 ? 2 : 3
  const lanes: BoardLane[] = [...statuses.values()]
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.first - b.first)
    .map((status) => ({ id: newId(), title: status.name, cards: status.cards }))
  return {
    board: { title: source.title || key, lanes },
    truncated: issues.length > MAX_CARDS
  }
}

async function kaitenSources(connection: KanbanConnection): Promise<KanbanSource[]> {
  const spaces = array(await request(connection, '/api/latest/spaces'))
  const sources: KanbanSource[] = []
  for (const space of spaces) {
    if (space.archived === true) continue
    const spaceId = number(space.id)
    const boards = Array.isArray(space.boards)
      ? array(space.boards)
      : array(await request(connection, `/api/latest/spaces/${spaceId}/boards`))
    for (const board of boards) {
      sources.push({
        id: String(number(board.id)),
        title: text(board.title) || `Доска ${number(board.id)}`,
        subtitle: text(space.title)
      })
    }
  }
  return sources
}

interface KaitenColumn {
  id: number
  title: string
  sort: number
  subcolumns?: JsonObject[]
}

interface KaitenLane extends BoardLane {
  externalId: number
}

function kaitenLanes(board: JsonObject): KaitenLane[] {
  const lanes: KaitenLane[] = []
  const columns = array(board.columns).map((column) => ({
    ...column,
    id: number(column.id),
    title: text(column.title),
    sort: number(column.sort_order),
    subcolumns: array(column.subcolumns)
  })) as KaitenColumn[]
  columns.sort((a, b) => a.sort - b.sort)
  for (const column of columns) {
    if (column.subcolumns?.length) {
      for (const subcolumn of column.subcolumns.sort((a, b) => number(a.sort_order) - number(b.sort_order))) {
        lanes.push({
          id: newId(),
          title: `${column.title} / ${text(subcolumn.title)}`,
          cards: [],
          externalId: number(subcolumn.id)
        })
      }
    } else {
      lanes.push({
        id: newId(),
        title: column.title || `Колонка ${column.id}`,
        cards: [],
        externalId: column.id
      })
    }
  }
  return lanes
}

async function kaitenImport(connection: KanbanConnection, source: KanbanSource): Promise<KanbanImportResult> {
  const boardId = number(source.id)
  if (!Number.isInteger(boardId) || boardId <= 0) throw new KanbanError('выберите доску Kaiten')
  const board = object(await request(connection, `/api/latest/boards/${boardId}`))
  const lanes = kaitenLanes(board)
  const byExternalId = new Map(lanes.map((lane) => [lane.externalId, lane]))
  const cards: JsonObject[] = []
  let offset = 0
  while (cards.length <= MAX_CARDS) {
    const limit = Math.min(PAGE_SIZE, MAX_CARDS + 1 - cards.length)
    const page = array(
      await request(
        connection,
        `/api/latest/cards?board_id=${boardId}&condition=1&additional_card_fields=description&limit=${limit}&offset=${offset}`
      )
    )
    cards.push(...page)
    offset += page.length
    if (page.length < limit) break
  }
  for (const item of cards.slice(0, MAX_CARDS)) {
    const columnId = number(item.column_id)
    let lane = byExternalId.get(columnId)
    if (!lane) {
      lane = { id: newId(), title: 'Без колонки', cards: [], externalId: columnId }
      lanes.push(lane)
      byExternalId.set(columnId, lane)
    }
    const responsible = object(item.responsible)
    const owner = object(item.owner)
    const assignee =
      text(responsible.full_name) || text(responsible.name) || text(owner.full_name) || text(owner.name)
    lane.cards.push(
      card({
        title: `#${number(item.id)} · ${text(item.title) || 'Без названия'}`,
        description: item.description,
        meta: [assignee && `Исполнитель: ${assignee}`]
      })
    )
  }
  return {
    board: {
      title: text(board.title) || source.title,
      lanes: lanes.map((lane) => ({ id: lane.id, title: lane.title, cards: lane.cards }))
    },
    truncated: cards.length > MAX_CARDS
  }
}

export async function listKanbanSources(connection: KanbanConnection): Promise<KanbanSource[]> {
  if (connection.provider === 'jira') return jiraSources(connection)
  if (connection.provider === 'kaiten') return kaitenSources(connection)
  throw new KanbanError('неизвестный канбан-сервис')
}

export async function importKanbanBoard(
  connection: KanbanConnection,
  source: KanbanSource
): Promise<KanbanImportResult> {
  if (connection.provider === 'jira') return jiraImport(connection, source)
  if (connection.provider === 'kaiten') return kaitenImport(connection, source)
  throw new KanbanError('неизвестный канбан-сервис')
}
