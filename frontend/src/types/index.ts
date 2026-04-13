export type DatabaseType = 'postgresql' | 'mssql'

export interface DatabaseConnection {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number
  username: string
  database: string
  connected: boolean
  schema?: TableSchema[]
  createdAt: string
}

export interface TableSchema {
  tableName: string
  columns: ColumnSchema[]
  relationships?: Relationship[]
}

export interface ColumnSchema {
  name: string
  dataType: string
  nullable: boolean
  primaryKey: boolean
  foreignKey?: string
}

export interface Relationship {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'table' | 'kpi'

export interface ChartConfig {
  id: string
  title: string
  type: ChartType
  sql: string
  data: Record<string, unknown>[]
  xKey?: string
  yKeys?: string[]
  color?: string
  databaseId: string
  createdAt: string
  layout: GridLayoutItem
}

export interface GridLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface DashboardTab {
  id: string
  name: string
  icon?: string
  charts: ChartConfig[]
  filters: FilterConfig[]
  createdAt: string
}

export interface FilterConfig {
  id: string
  name: string
  type: 'date_range' | 'select' | 'multi_select' | 'text'
  column: string
  table: string
  databaseId: string
  value?: unknown
  options?: string[]
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: string
  thinking?: boolean
  chartIds?: string[]
  intent?: string
  error?: boolean
}

export interface AIRequest {
  message: string
  tabId: string
  databaseId?: string
  filters?: FilterConfig[]
  existingCharts?: ChartConfig[]
}

export interface AIResponse {
  message: string
  intent: string
  charts?: ChartConfig[]
  action?: 'create_chart' | 'modify_chart' | 'delete_chart' | 'create_tab' | 'add_filter' | 'info'
  tabId?: string
  error?: string
}

export interface KPIData {
  label: string
  value: string | number
  change?: number
  changeLabel?: string
  prefix?: string
  suffix?: string
}
