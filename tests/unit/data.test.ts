import { describe, expect, it } from 'vitest'
import { applyNodePatch, buildNode, toAgentNode } from '@core/agent-ops'
import { dataMarkdown, dataSpec, makeDataSpec, normalizeDataSpec } from '@core/data'
import { nodeKind } from '@core/node-kind'
import { makeNode } from '@core/ops'
import { parseCanvas, serializeCanvas } from '@core/serialization'
import type { CanvasDoc, DocNode } from '@core/document'

const rect = { x: 0, y: 0, width: 480, height: 340 }
const opts = { shell: 'sh', defaultAgent: 'claude' }
const rows = [
  { run: 'первый', seconds: 12.4, passed: true },
  { run: 'второй', seconds: 10.8, passed: false }
]

function dataNode(): DocNode {
  return buildNode(
    { nodes: [], edges: [], extra: {} },
    {
      kind: 'data',
      title: 'Тесты',
      view: 'chart',
      data: rows,
      options: { x: 'run', y: 'seconds', series: 'line' }
    },
    rect,
    opts
  )
}

describe('data-нода', () => {
  it('строится с представлением и данными, доступными агенту', () => {
    const node = dataNode()
    expect(nodeKind(node)).toBe('data')
    expect(dataSpec(node)).toEqual({
      title: 'Тесты',
      view: 'chart',
      rows,
      options: { x: 'run', y: 'seconds', series: 'line' }
    })
    expect(toAgentNode(node)).toMatchObject({ kind: 'data', data: { title: 'Тесты', view: 'chart', rows } })
  })

  it('сохраняет спецификацию и markdown-представление в .canvas', () => {
    const doc: CanvasDoc = { nodes: [dataNode()], edges: [], extra: {} }
    const restored = parseCanvas(serializeCanvas(doc)).nodes[0]!
    expect(dataSpec(restored)).toEqual(dataSpec(doc.nodes[0]!))
    expect(restored.type === 'text' && restored.text).toContain('| run | seconds | passed |')
  })

  it('частично обновляет вид, строки и название', () => {
    const node = dataNode()
    const doc: CanvasDoc = { nodes: [node], edges: [], extra: {} }
    const changed = applyNodePatch(doc, node.id, {
      data: { view: 'metric', title: 'Прогресс', rows: [{ label: 'Тесты', value: 42, total: 50 }] }
    })
    expect(dataSpec(changed.nodes[0]!)).toEqual({
      title: 'Прогресс',
      view: 'metric',
      rows: [{ label: 'Тесты', value: 42, total: 50 }],
      options: { x: 'run', y: 'seconds', series: 'line' }
    })
    expect(() => applyNodePatch(changed, node.id, { text: 'руками' })).toThrow('data-ноде')
  })

  it('оставляет текстовую заметку для редакторов без cnv', () => {
    const spec = makeDataSpec({ title: 'Значения', rows: [{ name: 'a|b', value: 1 }] })
    expect(dataMarkdown(spec)).toContain('a\\|b')
    expect(makeDataSpec({ rows: [] })).toEqual({ title: 'Данные', view: 'table', rows: [], options: {} })
  })

  it('отклоняет вложенные и нечисловые значения', () => {
    expect(() => normalizeDataSpec({ rows: [{ value: { nested: true } }] })).toThrow('поле')
    expect(() => normalizeDataSpec({ rows: [{ value: Infinity }] })).toThrow('поле')
    expect(() => normalizeDataSpec({ rows: [], view: 'pie' })).toThrow('view')
  })

  it('неизвестная пометка data не ломает обычную карточку', () => {
    const node = makeNode({ type: 'text', text: 'обычная' }, rect)
    expect(dataSpec(node)).toBeNull()
    expect(nodeKind(node)).toBe('text')
  })
})
