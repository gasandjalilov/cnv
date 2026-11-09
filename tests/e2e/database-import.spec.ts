import { expect, test } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launchApp, type Harness } from './helpers'

let h: Harness

test.beforeAll(async () => {
  h = await launchApp({ canvasContent: JSON.stringify({ nodes: [], edges: [] }) })
})

test.afterAll(async () => {
  await h.close()
})

test('SQLite: подключение, выбор таблицы и одноразовый импорт без реквизитов в canvas', async () => {
  const file = path.join(h.workspaceRoot, 'analytics.db')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE releases (name TEXT, seconds REAL, passed INTEGER);
    INSERT INTO releases VALUES ('login', 12.4, 1), ('logout', 10.8, 0);
  `)
  db.close()

  await h.app.evaluate(({ dialog }, chosen) => {
    Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [chosen] }) })
  }, file)
  await h.page.locator('.create-bar__item[data-kind="data"]').click({ button: 'right' })
  await h.page.getByTestId('create-database-import').click()
  await expect(h.page.getByTestId('database-import')).toBeVisible()
  await h.page.getByTestId('database-choose-file').click()
  await expect(h.page.getByTestId('database-file')).toHaveValue(file)
  await h.page.getByTestId('database-connect').click()
  await expect(h.page.getByTestId('database-table')).toBeVisible()
  await expect(h.page.getByTestId('database-table').locator('option')).toHaveText([
    'Выберите таблицу…',
    'releases'
  ])
  await h.page.getByTestId('database-table').selectOption('0')
  await h.page.getByTestId('database-import-submit').click()

  await expect(h.page.getByTestId('database-import')).toHaveCount(0)
  await expect(h.page.locator('.node-data__title')).toHaveText('releases')
  await expect(h.page.getByTestId('data-table').locator('tbody tr')).toHaveCount(2)
  await expect(h.page.getByTestId('data-table')).toContainText('login')
  await expect(h.page.getByTestId('data-table')).toContainText('12,4')

  await h.page.evaluate(() => (window as unknown as { __cnvFlush(): Promise<void> }).__cnvFlush())
  const saved = await readFile(h.canvasFile, 'utf8')
  expect(saved).not.toContain(file)
  expect(saved).not.toContain('password')
  expect(JSON.parse(saved).nodes[0]['x-cnv'].data.rows).toEqual([
    { name: 'login', seconds: 12.4, passed: 1 },
    { name: 'logout', seconds: 10.8, passed: 0 }
  ])
})
