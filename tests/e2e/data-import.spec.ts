import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  })
  const body = (await response.json()) as { result: { content: { text?: string }[]; isError?: boolean } }
  const text = body.result.content[0]?.text ?? ''
  if (body.result.isError) throw new Error(text)
  return JSON.parse(text) as T
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'cnv-import-ud-'))
  h = await launchApp({ userDataDir: userData, canvasContent: JSON.stringify({ nodes: [], edges: [] }) })
  server = JSON.parse(await readFile(path.join(userData, 'mcp', 'server.json'), 'utf8')) as typeof server
})

test.afterAll(async () => {
  await h.close()
  await rm(userData, { recursive: true, force: true })
})

test('кнопка слева импортирует CSV через файловый диалог', async () => {
  const csv = path.join(h.workspaceRoot, 'release.csv')
  await writeFile(
    csv,
    '\uFEFFtest,seconds,passed,note\n"login, happy path",12.4,true,"готово"\nlogout,10.8,false,"исправить"\n'
  )
  await h.app.evaluate(({ dialog }, file) => {
    Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) })
  }, csv)

  await expect(h.page.locator('.create-bar__item[data-kind="dataImport"]')).toHaveCount(0)
  await h.page.locator('.create-bar__item[data-kind="data"]').click({ button: 'right' })
  await expect(h.page.getByTestId('create-data-options')).toBeVisible()
  await expect(h.page.getByTestId('create-data-empty')).toBeVisible()
  await h.page.getByTestId('create-data-import').click()
  const data = h.page.getByTestId('data-node')
  await expect(data).toBeVisible()
  await expect(data.locator('.node-data__title')).toHaveText('release')
  await expect(h.page.getByTestId('data-table').locator('tbody tr')).toHaveCount(2)
  await expect(h.page.getByTestId('data-table')).toContainText('login, happy path')
  await expect(h.page.getByTestId('data-table')).toContainText('12,4')

  await tool('save', {})
  const saved = JSON.parse(await readFile(h.canvasFile, 'utf8')) as {
    nodes: { 'x-cnv': { data: { title: string; rows: unknown[] } } }[]
  }
  expect(saved.nodes[0]?.['x-cnv'].data.rows).toHaveLength(2)
})

test('MCP импортирует JSON из workspace и TSV из внешнего файла', async () => {
  await writeFile(
    path.join(h.workspaceRoot, 'metrics.json'),
    JSON.stringify([{ label: 'Тесты', value: 42, total: 50 }])
  )
  const json = await tool<AgentNode>('create_node', {
    kind: 'data',
    file: 'metrics.json',
    view: 'metric',
    x: 600,
    y: 0
  })
  expect(json.data).toMatchObject({ title: 'metrics', view: 'metric', rows: [{ value: 42, total: 50 }] })
  await expect(h.page.getByTestId('data-metrics')).toContainText('42')

  const tsv = path.join(userData, 'external.tsv')
  await writeFile(tsv, 'run\tseconds\nпервый\t10.8\n')
  const table = await tool<AgentNode>('create_node', { kind: 'data', file: tsv, x: 1100, y: 0 })
  expect(table.data).toMatchObject({ title: 'external', rows: [{ run: 'первый', seconds: 10.8 }] })
  await expect(h.page.locator(`[data-node-id="${table.id}"]`)).toContainText('10,8')
  expect(await readFile(path.join(h.workspaceRoot, 'attachments', 'external.tsv'), 'utf8')).toContain('10.8')
})
