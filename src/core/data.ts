import type { DocNode } from './document'

export const DATA_VIEWS = ['metric', 'table', 'chart'] as const
export type DataView = (typeof DATA_VIEWS)[number]
export type DataCell = string | number | boolean | null
export type DataRow = Record<string, DataCell>

export interface DataOptions {
  x?: string
  y?: string
  series?: 'line' | 'bar'
}

export interface DataSpec {
  title: string
  view: DataView
  rows: DataRow[]
  options: DataOptions
}

export interface DataSpecInput {
  title?: string
  view?: DataView
  rows: DataRow[]
  options?: DataOptions
}

export interface DataSpecPatch {
  title?: string
  view?: DataView
  rows?: DataRow[]
  options?: DataOptions
}

export class DataError extends Error {}

export const DATA_SIZE = { width: 480, height: 340 } as const
export const DATA_MAX_ROWS = 500

const KEY = 'x-cnv'
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function cell(value: unknown, key: string): DataCell {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value.slice(0, 1000)
  throw new DataError(`поле «${key}»: нужны строка, число, boolean или null`)
}

export function normalizeDataSpec(value: unknown): DataSpec {
  if (!isRecord(value)) throw new DataError('data: нужен объект')
  if (!Array.isArray(value.rows)) throw new DataError('data: нужен массив rows')
  if (value.rows.length > DATA_MAX_ROWS) throw new DataError(`data: не больше ${DATA_MAX_ROWS} строк`)
  const view = value.view ?? 'table'
  if (typeof view !== 'string' || !(DATA_VIEWS as readonly string[]).includes(view)) {
    throw new DataError(`view: одно из ${DATA_VIEWS.join(', ')}`)
  }
  const rows = value.rows.map((row, index) => {
    if (!isRecord(row)) throw new DataError(`data[${index}]: нужен объект`)
    const entries = Object.entries(row)
    if (entries.length > 30) throw new DataError(`data[${index}]: не больше 30 полей`)
    return Object.fromEntries(
      entries.map(([key, item]) => {
        if (!key.trim()) throw new DataError(`data[${index}]: пустое имя поля`)
        return [key.slice(0, 80), cell(item, key)]
      })
    )
  })
  const rawOptions = value.options === undefined ? {} : value.options
  if (!isRecord(rawOptions)) throw new DataError('options: нужен объект')
  const options: DataOptions = {}
  for (const key of ['x', 'y'] as const) {
    const field = rawOptions[key]
    if (field !== undefined) {
      if (typeof field !== 'string' || !field.trim()) throw new DataError(`options.${key}: нужно имя поля`)
      options[key] = field
    }
  }
  if (rawOptions.series !== undefined) {
    if (rawOptions.series !== 'line' && rawOptions.series !== 'bar') {
      throw new DataError('options.series: line или bar')
    }
    options.series = rawOptions.series
  }
  return {
    title:
      typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 120) : 'Данные',
    view: view as DataView,
    rows,
    options
  }
}

export function makeDataSpec(input: DataSpecInput): DataSpec {
  return normalizeDataSpec({
    title: input.title,
    view: input.view,
    rows: input.rows,
    options: input.options
  })
}

export function dataSpec(node: DocNode): DataSpec | null {
  if (node.type !== 'text') return null
  const own = node.extra[KEY]
  const value = isRecord(own) ? own.data : undefined
  if (value === undefined) return null
  try {
    return normalizeDataSpec(value)
  } catch {
    return null
  }
}

export const isData = (node: DocNode): boolean => dataSpec(node) !== null

export function dataColumns(rows: readonly DataRow[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) columns.add(key)
  return [...columns]
}

const markdownCell = (value: DataCell | undefined): string =>
  value === undefined || value === null ? '' : String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function dataMarkdown(spec: DataSpec): string {
  const columns = dataColumns(spec.rows)
  if (!columns.length) return `## ${spec.title}\n\nНет данных`
  const header = `| ${columns.join(' | ')} |`
  const separator = `| ${columns.map(() => '---').join(' | ')} |`
  const rows = spec.rows.map((row) => `| ${columns.map((key) => markdownCell(row[key])).join(' | ')} |`)
  return [`## ${spec.title}`, '', header, separator, ...rows].join('\n')
}

export function withData(node: DocNode, spec: DataSpec): DocNode {
  if (node.type !== 'text') return node
  const own = isRecord(node.extra[KEY]) ? node.extra[KEY] : {}
  return { ...node, text: dataMarkdown(spec), extra: { ...node.extra, [KEY]: { ...own, data: spec } } }
}
