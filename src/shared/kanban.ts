import type { BoardSpec } from '@core/board'

export type KanbanProvider = 'jira' | 'kaiten'

export interface KanbanConnection {
  provider: KanbanProvider
  url: string
  email?: string
  token: string
}

export interface KanbanSource {
  id: string
  title: string
  subtitle?: string
}

export interface KanbanImportResult {
  board: BoardSpec
  truncated: boolean
}
