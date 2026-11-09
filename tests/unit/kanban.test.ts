import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { importKanbanBoard, listKanbanSources } from '../../src/main/kanban'

let server: ReturnType<typeof createServer>
let url: string
let handler: (req: IncomingMessage, res: ServerResponse, body: string) => void

beforeEach(async () => {
  handler = (_req, res) => {
    res.writeHead(404).end('{}')
  }
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => handler(req, res, body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

const json = (res: ServerResponse, value: unknown): void => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

describe('импорт канбан-досок', () => {
  it('Jira: Basic auth, проекты, актуальный JQL API и дорожки по статусам', async () => {
    const token = 'jira-secret'
    handler = (req, res, body) => {
      if (req.url?.startsWith('/rest/api/3/project/search')) {
        expect(req.headers.authorization).toBe(
          `Basic ${Buffer.from(`dev@example.com:${token}`).toString('base64')}`
        )
        return json(res, { values: [{ key: 'CNV', name: 'Canvas' }], startAt: 0, total: 1 })
      }
      if (req.url === '/rest/api/3/search/jql') {
        const payload = JSON.parse(body)
        expect(payload).toMatchObject({
          jql: 'project = "CNV" ORDER BY created ASC',
          fields: ['summary', 'status', 'description', 'assignee', 'priority'],
          maxResults: 100
        })
        return json(res, {
          isLast: true,
          issues: [
            {
              key: 'CNV-2',
              fields: {
                summary: 'Готово',
                status: { name: 'Done', statusCategory: { id: 3 } },
                description: 'Сделано'
              }
            },
            {
              key: 'CNV-1',
              fields: {
                summary: 'Сделать импорт',
                status: { name: 'To Do', statusCategory: { id: 2 } },
                description: {
                  type: 'doc',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Описание задачи' }] }]
                },
                assignee: { displayName: 'Даня' },
                priority: { name: 'High' }
              }
            }
          ]
        })
      }
      res.writeHead(404).end('{}')
    }
    const connection = { provider: 'jira', url, email: 'dev@example.com', token } as const
    await expect(listKanbanSources(connection)).resolves.toEqual([
      { id: 'CNV', title: 'Canvas', subtitle: 'CNV' }
    ])
    const result = await importKanbanBoard(connection, { id: 'CNV', title: 'Canvas' })

    expect(result.truncated).toBe(false)
    expect(result.board.title).toBe('Canvas')
    expect(result.board.lanes.map((lane) => lane.title)).toEqual(['To Do', 'Done'])
    expect(result.board.lanes[0]?.cards[0]?.text).toBe(
      '**CNV-1 · Сделать импорт**\n\nОписание задачи\n\n_Исполнитель: Даня · Приоритет: High_'
    )
    expect(result.board.lanes[1]?.cards[0]?.text).toBe('**CNV-2 · Готово**\n\nСделано')
    expect(JSON.stringify(result.board)).not.toContain(token)
  })

  it('Jira: читает nextPageToken и обрезает результат до 500 карточек', async () => {
    let calls = 0
    handler = (req, res, body) => {
      expect(req.url).toBe('/rest/api/3/search/jql')
      const payload = JSON.parse(body)
      if (calls > 0) expect(payload.nextPageToken).toBe('next')
      calls++
      const count = Math.min(payload.maxResults, 501 - (calls - 1) * 100)
      json(res, {
        isLast: calls === 6,
        ...(calls < 6 ? { nextPageToken: 'next' } : {}),
        issues: Array.from({ length: count }, (_, index) => ({
          key: `CNV-${(calls - 1) * 100 + index + 1}`,
          fields: { summary: 'Задача', status: { name: 'To Do', statusCategory: { id: 2 } } }
        }))
      })
    }
    const result = await importKanbanBoard(
      { provider: 'jira', url, email: 'dev@example.com', token: 'token' },
      { id: 'CNV', title: 'Canvas' }
    )
    expect(calls).toBe(6)
    expect(result.truncated).toBe(true)
    expect(result.board.lanes[0]?.cards).toHaveLength(500)
  })

  it('Kaiten: Bearer auth, доски пространств, колонки и карточки', async () => {
    const token = 'kaiten-secret'
    handler = (req, res) => {
      expect(req.headers.authorization).toBe(`Bearer ${token}`)
      if (req.url === '/api/latest/spaces') {
        return json(res, [
          { id: 1, title: 'Продукт', archived: false, boards: [{ id: 7, title: 'Спринт' }] },
          { id: 2, title: 'Архив', archived: true, boards: [{ id: 8, title: 'Старый' }] }
        ])
      }
      if (req.url === '/api/latest/boards/7') {
        return json(res, {
          title: 'Спринт 42',
          columns: [
            {
              id: 1,
              title: 'Queue',
              sort_order: 1,
              subcolumns: [{ id: 11, title: 'Ready', sort_order: 1 }]
            },
            { id: 2, title: 'Done', sort_order: 2, subcolumns: [] }
          ]
        })
      }
      if (req.url?.startsWith('/api/latest/cards?')) {
        const query = new URL(req.url, url).searchParams
        expect(query.get('board_id')).toBe('7')
        expect(query.get('condition')).toBe('1')
        expect(query.get('additional_card_fields')).toBe('description')
        expect(query.get('offset')).toBe('0')
        return json(res, [
          {
            id: 101,
            title: 'Подключить Kaiten',
            column_id: 11,
            description: 'Через API',
            responsible: { full_name: 'Лиза' }
          },
          { id: 102, title: 'Проверить', column_id: 2 }
        ])
      }
      res.writeHead(404).end('{}')
    }
    const connection = { provider: 'kaiten', url, token } as const
    await expect(listKanbanSources(connection)).resolves.toEqual([
      { id: '7', title: 'Спринт', subtitle: 'Продукт' }
    ])
    const result = await importKanbanBoard(connection, { id: '7', title: 'Спринт' })

    expect(result.truncated).toBe(false)
    expect(result.board.title).toBe('Спринт 42')
    expect(result.board.lanes.map((lane) => lane.title)).toEqual(['Queue / Ready', 'Done'])
    expect(result.board.lanes[0]?.cards[0]?.text).toBe(
      '**#101 · Подключить Kaiten**\n\nЧерез API\n\n_Исполнитель: Лиза_'
    )
    expect(result.board.lanes[1]?.cards[0]?.text).toBe('**#102 · Проверить**')
    expect(JSON.stringify(result.board)).not.toContain(token)
  })

  it('не показывает токен в ошибке сервера и проверяет его наличие', async () => {
    const token = 'do-not-show'
    handler = (_req, res) => {
      res
        .writeHead(401, { 'content-type': 'application/json' })
        .end(JSON.stringify({ message: `bad ${token}` }))
    }
    const error = await listKanbanSources({ provider: 'kaiten', url, token }).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('•••')
    expect((error as Error).message).not.toContain(token)
    await expect(listKanbanSources({ provider: 'kaiten', url, token: '' })).rejects.toThrow(
      'укажите API-токен'
    )
  })
})
