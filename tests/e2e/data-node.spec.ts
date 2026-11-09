import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentNode } from '../../src/shared/agent'
import { launchApp, type Harness } from './helpers'

let h: Harness
let userData: string
let server: { url: string; token: string }

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(server.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${server.token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args }
    })
  })
  const body = (await response.json()) as { result: { content: { text?: string }[]; isError?: boolean } }
  const text = body.result.content[0]?.text ?? ''
  if (body.result.isError) throw new Error(text)
  return JSON.parse(text) as T
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'cnv-data-ud-'))
  h = await launchApp({ userDataDir: userData, canvasContent: JSON.stringify({ nodes: [], edges: [] }) })
  server = JSON.parse(await readFile(path.join(userData, 'mcp', 'server.json'), 'utf8')) as typeof server
})

test.afterAll(async () => {
  await h.close()
  await rm(userData, { recursive: true, force: true })
})

test('MCP создаёт data-ноду, человек меняет вид, данные сохраняются', async () => {
  const created = await tool<AgentNode>('create_node', {
    kind: 'data',
    title: 'Длительность тестов',
    view: 'chart',
    data: [
      { run: 'первый', seconds: 12.4 },
      { run: 'второй', seconds: 10.8 },
      { run: 'третий', seconds: 11.2 }
    ],
    options: { x: 'run', y: 'seconds', series: 'line' },
    x: 0,
    y: 0
  })
  expect(created.kind).toBe('data')
  expect(created.data?.view).toBe('chart')

  const node = h.page.locator(`[data-node-id="${created.id}"]`)
  await expect(node).toHaveAttribute('data-node-kind', 'data')
  await expect(h.page.getByTestId('data-chart')).toBeVisible()
  await expect(h.page.getByTestId('data-chart-line')).toHaveCount(1)

  await tool('update_node', {
    id: created.id,
    options: { x: 'run', y: 'seconds', series: 'bar' }
  })
  await expect(h.page.getByTestId('data-chart-bar')).toHaveCount(3)

  await node.dblclick({ position: { x: 40, y: 15 } })
  await h.page.getByTestId('data-view-table').click()
  await expect(h.page.getByTestId('data-table')).toBeVisible()
  await expect(h.page.getByTestId('data-table').locator('tbody tr')).toHaveCount(3)

  await tool('update_node', {
    id: created.id,
    title: 'Прогресс релиза',
    view: 'metric',
    data: [{ label: 'Тесты', value: 42, total: 50, unit: 'шт.' }]
  })
  await expect(h.page.getByTestId('data-metrics')).toContainText('42')
  await expect(h.page.getByTestId('data-metrics')).toContainText('из 50')
  await expect(h.page.locator('.node-data__progress-value')).toHaveAttribute('style', 'width: 84%;')

  await tool('save', {})
  const onDisk = JSON.parse(await readFile(h.canvasFile, 'utf8')) as {
    nodes: { id: string; text: string; 'x-cnv': { data: AgentNode['data'] } }[]
  }
  const saved = onDisk.nodes.find((item) => item.id === created.id)
  expect(saved?.['x-cnv'].data).toMatchObject({
    title: 'Прогресс релиза',
    view: 'metric',
    rows: [{ label: 'Тесты', value: 42, total: 50, unit: 'шт.' }]
  })
  expect(saved?.text).toContain('| label | value | total | unit |')
})
