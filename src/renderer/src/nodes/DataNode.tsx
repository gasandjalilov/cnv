import { useMemo } from 'react'
import type { DocNode } from '@core/document'
import { applyNodePatch } from '@core/agent-ops'
import { DATA_VIEWS, dataColumns, dataSpec, type DataCell, type DataRow, type DataSpec } from '@core/data'
import { useCanvasEnv } from '@renderer/canvas/env'
import type { NodeViewProps } from './registry'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

function show(value: DataCell | undefined): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'number') return number.format(value)
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  return value || '—'
}

function Empty({ children }: { children: string }): React.JSX.Element {
  return <div className="node-data__empty">{children}</div>
}

function Metrics({ rows }: { rows: DataRow[] }): React.JSX.Element {
  if (!rows.length) return <Empty>Нет данных</Empty>
  return (
    <div className="node-data__metrics" data-testid="data-metrics">
      {rows.map((row, index) => {
        const value = row.value
        const total = typeof row.total === 'number' && row.total > 0 ? row.total : null
        const percent =
          total && typeof value === 'number' ? Math.min(100, Math.max(0, (value / total) * 100)) : null
        return (
          <div className="node-data__metric" key={index}>
            <div className="node-data__metric-label">
              {show(row.label ?? row.name ?? `Метрика ${index + 1}`)}
            </div>
            <div className="node-data__metric-value">
              {show(value)}
              {row.unit !== undefined && <span className="node-data__metric-unit">{show(row.unit)}</span>}
            </div>
            {total && <div className="node-data__metric-total">из {number.format(total)}</div>}
            {percent !== null && (
              <div className="node-data__progress" aria-label={`${number.format(percent)}%`}>
                <div className="node-data__progress-value" style={{ width: `${percent}%` }} />
              </div>
            )}
            {row.delta !== undefined && <div className="node-data__metric-delta">{show(row.delta)}</div>}
          </div>
        )
      })}
    </div>
  )
}

function Table({ rows }: { rows: DataRow[] }): React.JSX.Element {
  const columns = dataColumns(rows)
  if (!columns.length) return <Empty>Нет данных</Empty>
  return (
    <div className="node-data__table-wrap">
      <table className="node-data__table" data-testid="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} title={show(row[column])}>
                  {show(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ChartPoint {
  label: string
  value: number
}

function chartPoints(spec: DataSpec): { points: ChartPoint[]; x?: string; y?: string } {
  const columns = dataColumns(spec.rows)
  const x = spec.options.x ?? columns[0]
  const y =
    spec.options.y ??
    columns.find((column) => column !== x && spec.rows.some((row) => typeof row[column] === 'number'))
  if (!x || !y) return { points: [], x, y }
  return {
    x,
    y,
    points: spec.rows.flatMap((row, index) =>
      typeof row[y] === 'number'
        ? [{ label: row[x] === undefined ? String(index + 1) : show(row[x]), value: row[y] as number }]
        : []
    )
  }
}

function Chart({ spec }: { spec: DataSpec }): React.JSX.Element {
  const { points, y } = useMemo(() => chartPoints(spec), [spec])
  if (!points.length || !y) return <Empty>Нужны строки с числовым полем для графика</Empty>

  const width = 440
  const height = 220
  const margin = { top: 12, right: 12, bottom: 34, left: 46 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const series = spec.options.series ?? 'line'
  const values = points.map((point) => point.value)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const padding = series === 'line' ? (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.1 : 0
  const min = series === 'bar' ? Math.min(0, rawMin) : rawMin - padding
  const max = Math.max(series === 'bar' ? 0 : rawMax + padding, min + 1)
  const xAt = (index: number): number =>
    margin.left +
    (series === 'bar'
      ? ((index + 0.5) / points.length) * plotWidth
      : (index / Math.max(1, points.length - 1)) * plotWidth)
  const yAt = (value: number): number => margin.top + ((max - value) / (max - min)) * plotHeight
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${xAt(index)},${yAt(point.value)}`).join(' ')
  const zeroY = yAt(Math.max(min, Math.min(0, max)))
  const barWidth = Math.max(2, (plotWidth / points.length) * 0.65)
  const labels = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]

  return (
    <div className="node-data__chart-wrap">
      <svg
        className="node-data__chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${spec.title}: ${y}`}
        data-testid="data-chart"
      >
        {[0, 0.5, 1].map((ratio) => {
          const value = max - ratio * (max - min)
          const yPos = margin.top + ratio * plotHeight
          return (
            <g key={ratio}>
              <line
                className="node-data__grid"
                x1={margin.left}
                x2={width - margin.right}
                y1={yPos}
                y2={yPos}
              />
              <text className="node-data__tick" x={margin.left - 6} y={yPos + 3} textAnchor="end">
                {number.format(value)}
              </text>
            </g>
          )
        })}
        {series === 'line' ? (
          <>
            <path className="node-data__chart-line" d={path} data-testid="data-chart-line" />
            {points.map((point, index) => (
              <circle
                className="node-data__chart-point"
                key={index}
                cx={xAt(index)}
                cy={yAt(point.value)}
                r={3}
              />
            ))}
          </>
        ) : (
          points.map((point, index) => {
            const valueY = yAt(point.value)
            return (
              <rect
                className="node-data__chart-bar"
                data-testid="data-chart-bar"
                key={index}
                x={xAt(index) - barWidth / 2}
                y={Math.min(valueY, zeroY)}
                width={barWidth}
                height={Math.max(1, Math.abs(zeroY - valueY))}
                rx={2}
              />
            )
          })
        )}
        {labels.map((index) => (
          <text className="node-data__tick" key={index} x={xAt(index)} y={height - 10} textAnchor="middle">
            {points[index]?.label}
          </text>
        ))}
      </svg>
    </div>
  )
}

export function DataNodeView({ node }: NodeViewProps<DocNode>): React.JSX.Element {
  const { store } = useCanvasEnv()
  const spec = dataSpec(node)
  if (!spec) return <div className="node-data" />

  const setView = (view: (typeof DATA_VIEWS)[number]): void => {
    if (view === spec.view) return
    store.mutate('представление данных', (doc) => applyNodePatch(doc, node.id, { data: { view } }))
  }

  return (
    <div className="node-data" data-testid="data-node" data-view={spec.view}>
      <div className="node-data__header">
        <div className="node-data__title" title={spec.title}>
          {spec.title}
        </div>
        <div className="node-data__views" role="group" aria-label="Представление данных">
          {DATA_VIEWS.map((view) => (
            <button
              type="button"
              key={view}
              className={view === spec.view ? 'node-data__view node-data__view--current' : 'node-data__view'}
              data-testid={`data-view-${view}`}
              aria-pressed={view === spec.view}
              title={view === 'metric' ? 'Метрики' : view === 'table' ? 'Таблица' : 'График'}
              onClick={() => setView(view)}
            >
              {view === 'metric' ? '123' : view === 'table' ? '▦' : '⌁'}
            </button>
          ))}
        </div>
      </div>
      <div className="node-data__content">
        {spec.view === 'metric' ? (
          <Metrics rows={spec.rows} />
        ) : spec.view === 'table' ? (
          <Table rows={spec.rows} />
        ) : (
          <Chart spec={spec} />
        )}
      </div>
    </div>
  )
}

export function DataNodeLowDetail({ node }: NodeViewProps<DocNode>): React.JSX.Element {
  const spec = dataSpec(node)
  return <div className="node-lod node-data--lod">{spec?.title ?? 'Данные'}</div>
}
