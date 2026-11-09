import { normalizeDataSpec, type DataCell, type DataRow } from './data'

export class DataImportError extends Error {}

function delimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const finishField = (): void => {
    row.push(field)
    field = ''
  }
  const finishRow = (): void => {
    finishField()
    if (row.some((value) => value.trim() !== '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index++
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"' && field === '') quoted = true
    else if (char === delimiter) finishField()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      finishRow()
    } else field += char
  }
  if (quoted) throw new DataImportError('CSV: не закрыта кавычка')
  finishRow()
  return rows
}

function delimiterFor(text: string, extension: string): string {
  if (extension === 'tsv') return '\t'
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const candidates = ['\t', ';', ',']
  let quoted = false
  const scores = new Map(candidates.map((candidate) => [candidate, 0]))
  for (let index = 0; index < firstLine.length; index++) {
    const char = firstLine[index]!
    if (char === '"' && firstLine[index + 1] === '"') index++
    else if (char === '"') quoted = !quoted
    else if (!quoted && scores.has(char)) scores.set(char, (scores.get(char) ?? 0) + 1)
  }
  return candidates.reduce((best, candidate) =>
    (scores.get(candidate) ?? 0) > (scores.get(best) ?? 0) ? candidate : best
  )
}

function headers(row: string[]): string[] {
  const used = new Map<string, number>()
  return row.map((value, index) => {
    const base = value.trim() || `column ${index + 1}`
    const count = (used.get(base) ?? 0) + 1
    used.set(base, count)
    return count === 1 ? base : `${base}_${count}`
  })
}

function dataCell(value: string, delimiter: string): DataCell {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^true$/i.test(trimmed)) return true
  if (/^false$/i.test(trimmed)) return false
  const numeric = delimiter !== ',' && trimmed.includes(',') ? trimmed.replace(',', '.') : trimmed
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(numeric)) {
    const parsed = Number(numeric)
    if (Number.isFinite(parsed)) return parsed
  }
  return value
}

function parseDelimited(text: string, extension: string): DataRow[] {
  const delimiter = delimiterFor(text, extension)
  const [header, ...rows] = delimitedRows(text, delimiter)
  if (!header) return []
  const columns = headers(header)
  const parsed = rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, dataCell(row[index] ?? '', delimiter)]))
  )
  return normalizeDataSpec({ rows: parsed }).rows
}

function parseJson(text: string): DataRow[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new DataImportError(`JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as { rows?: unknown }).rows
      : null
  if (!Array.isArray(rows))
    throw new DataImportError('JSON: нужен массив объектов или объект с массивом rows')
  return normalizeDataSpec({ rows }).rows
}

export function parseTableFile(fileName: string, source: string): DataRow[] {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const text = source.replace(/^\uFEFF/, '')
  if (extension === 'json') return parseJson(text)
  if (extension !== 'csv' && extension !== 'tsv') {
    throw new DataImportError(`не поддерживается .${extension || 'файл'}: нужны CSV, TSV или JSON`)
  }
  return parseDelimited(text, extension)
}
