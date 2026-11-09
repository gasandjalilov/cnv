import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFile } from 'node:fs/promises'
import { launchApp, type Harness } from './helpers'

const JIRA_TOKEN = 'jira-e2e-secret'
const KAITEN_TOKEN = 'kaiten-e2e-secret'
let h: Harness
let server: ReturnType<typeof createServer>
let url: string

const json = (res: import('node:http').ServerResponse, value: unknown): void => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/rest/api/3/project/search')) {
      return json(res, { values: [{ key: 'CNV', name: 'Canvas' }], total: 1 })
    }
    if (req.url === '/rest/api/3/search/jql') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        expect(JSON.parse(body).jql).toContain('CNV')
        json(res, {
          isLast: true,
          issues: [
            {
              key: 'CNV-1',
              fields: {
                summary: 'Импорт из Jira',
                status: { name: 'To Do', statusCategory: { id: 2 } },
                description: 'Работает'
              }
            }
          ]
        })
      })
      return
    }
    if (req.url === '/api/latest/spaces') {
      return json(res, [{ id: 1, title: 'Продукт', boards: [{ id: 7, title: 'Спринт' }] }])
    }
    if (req.url === '/api/latest/boards/7') {
      return json(res, {
        title: 'Спринт Kaiten',
        columns: [{ id: 2, title: 'In progress', sort_order: 1, subcolumns: [] }]
      })
    }
    if (req.url?.startsWith('/api/latest/cards?')) {
      return json(res, [{ id: 101, title: 'Импорт из Kaiten', column_id: 2, description: 'Тоже работает' }])
    }
    res.writeHead(404).end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  h = await launchApp({ canvasContent: JSON.stringify({ nodes: [], edges: [] }) })
})

test.afterAll(async () => {
  await h.close()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

async function openDialog(provider: 'jira' | 'kaiten'): Promise<void> {
  await h.page.locator('.create-bar__item[data-kind="board"]').click({ button: 'right' })
  await h.page.getByTestId('create-kanban-import').click()
  await h.page.getByTestId('kanban-provider').selectOption(provider)
  await h.page.getByTestId('kanban-url').fill(url)
}

async function saved(): Promise<string> {
  await h.page.evaluate(() => (window as unknown as { __cnvFlush(): Promise<void> }).__cnvFlush())
  return readFile(h.canvasFile, 'utf8')
}

test('Jira: проект превращается в доску, токен и адрес не сохраняются', async () => {
  await openDialog('jira')
  await h.page.getByTestId('kanban-email').fill('dev@example.com')
  await h.page.getByTestId('kanban-token').fill(JIRA_TOKEN)
  await h.page.getByTestId('kanban-connect').click()
  await expect(h.page.getByTestId('kanban-source')).toBeVisible()
  await h.page.getByTestId('kanban-source').selectOption('0')
  await h.page.getByTestId('kanban-import-submit').click()

  await expect(h.page.getByTestId('kanban-import')).toHaveCount(0)
  const board = h.page.getByTestId('board').first()
  await expect(board.locator('.board__title')).toHaveText('Canvas')
  await expect(board.getByTestId('board-lane-title')).toHaveText(['To Do'])
  await expect(board.getByTestId('board-card')).toContainText('CNV-1 · Импорт из Jira')
  const canvas = await saved()
  expect(canvas).not.toContain(JIRA_TOKEN)
  expect(canvas).not.toContain(url)
})

test('Kaiten: доска и колонки импортируются, токен и адрес не сохраняются', async () => {
  await openDialog('kaiten')
  await expect(h.page.getByTestId('kanban-email')).toHaveCount(0)
  await h.page.getByTestId('kanban-token').fill(KAITEN_TOKEN)
  await h.page.getByTestId('kanban-connect').click()
  await expect(h.page.getByTestId('kanban-source')).toBeVisible()
  await h.page.getByTestId('kanban-source').selectOption('0')
  await h.page.getByTestId('kanban-import-submit').click()

  await expect(h.page.getByTestId('kanban-import')).toHaveCount(0)
  const board = h.page.getByTestId('board').nth(1)
  await expect(board.locator('.board__title')).toHaveText('Спринт Kaiten')
  await expect(board.getByTestId('board-lane-title')).toHaveText(['In progress'])
  await expect(board.getByTestId('board-card')).toContainText('#101 · Импорт из Kaiten')
  const canvas = await saved()
  expect(canvas).not.toContain(KAITEN_TOKEN)
  expect(canvas).not.toContain(url)
})
