export type ColumnRole =
  | 'Date'
  | 'Time'
  | 'Open'
  | 'High'
  | 'Low'
  | 'Close'
  | 'Volume'
  | 'Value'
  | 'Other'

export type SortDirection = 'asc' | 'desc'
export type ThemeMode = 'dark' | 'light'

export interface DataColumn {
  id: string
  name: string
  role: ColumnRole
}

export type DataRow = Record<string, string>

export interface Dataset {
  id: string
  name: string
  groupId?: string
  order?: number
  columns: DataColumn[]
  rows: DataRow[]
  createdAt: number
  updatedAt: number
}

export interface DatasetGroup {
  id: string
  name: string
  order?: number
  createdAt: number
  updatedAt: number
}

export interface PaneIndicatorSettings {
  height: number
  zoom: number
}

export interface SmaIndicatorConfig {
  id: string
  type: 'SMA'
  period: number
  color: string
}

export interface EmaIndicatorConfig {
  id: string
  type: 'EMA'
  period: number
  color: string
}

export interface WmaIndicatorConfig {
  id: string
  type: 'WMA'
  period: number
  color: string
}

export interface BollingerIndicatorConfig {
  id: string
  type: 'BOLLINGER'
  period: number
  multiplier: number
  color: string
}

export interface VwapIndicatorConfig {
  id: string
  type: 'VWAP'
  color: string
}

export interface SupertrendIndicatorConfig {
  id: string
  type: 'SUPERTREND'
  period: number
  multiplier: number
}

export interface RsiIndicatorConfig {
  id: string
  type: 'RSI'
  period: number
  height: number
  zoom: number
}

export interface MacdIndicatorConfig {
  id: string
  type: 'MACD'
  fast: number
  slow: number
  signal: number
  height: number
  zoom: number
}

export interface StochasticIndicatorConfig extends PaneIndicatorSettings {
  id: string
  type: 'STOCHASTIC'
  kPeriod: number
  dPeriod: number
}

export interface AtrIndicatorConfig extends PaneIndicatorSettings {
  id: string
  type: 'ATR'
  period: number
}

export interface AdxIndicatorConfig extends PaneIndicatorSettings {
  id: string
  type: 'ADX'
  period: number
}

export interface ObvIndicatorConfig extends PaneIndicatorSettings {
  id: string
  type: 'OBV'
}

export interface IchimokuIndicatorConfig {
  id: string
  type: 'ICHIMOKU'
  tenkan: number
  kijun: number
  senkouB: number
}

export type ChartIndicatorConfig =
  | SmaIndicatorConfig
  | EmaIndicatorConfig
  | WmaIndicatorConfig
  | BollingerIndicatorConfig
  | VwapIndicatorConfig
  | SupertrendIndicatorConfig
  | RsiIndicatorConfig
  | MacdIndicatorConfig
  | StochasticIndicatorConfig
  | AtrIndicatorConfig
  | AdxIndicatorConfig
  | ObvIndicatorConfig
  | IchimokuIndicatorConfig
export type ChartLayoutMode = 1 | 2 | '2v' | 4
export type ChartPriceType = 'candlestick' | 'line'

export interface VisibleTimeRange {
  from: string
  to: string
}

export interface ChartPanelConfig {
  id: string
  datasetId: string
  chartType: ChartPriceType
  indicators: ChartIndicatorConfig[]
}

export interface ChartFilterState {
  layout: ChartLayoutMode
  panels: ChartPanelConfig[]
  replayEnabled: boolean
  replayDate: string | null
}

export interface WorkspaceState {
  datasets: Dataset[]
  groups: DatasetGroup[]
  collapsedGroupIds: string[]
  chartFilter: ChartFilterState
  activeDatasetId: string
  theme: ThemeMode
}

export interface CellIssue {
  key: string
  message: string
  severity: 'warning' | 'error'
}

export interface DatasetValidation {
  cellIssues: Map<string, CellIssue>
  summary: CellIssue[]
}

export interface ParsedPoint {
  dateIso: string
  dateLabel: string
  values: Record<string, number>
}

export interface DatasetUpdateReport {
  datasetName: string
  totalRows: number
  importedRows: number
  invalidRows: number
  duplicateDates: number
  earliestDate: string | null
  latestDate: string | null
  inserted: number
  updated: number
  unchanged: number
  errors: string[]
}

export interface MasterUpdateReport {
  datasetsProcessed: number
  totalRows: number
  importedRows: number
  invalidRows: number
  duplicateDates: number
  earliestDate: string | null
  latestDate: string | null
  inserted: number
  updated: number
  unchanged: number
  errors: number
  datasetReports: DatasetUpdateReport[]
}

export type DailyDuplicateReason = 'existing' | 'incoming'

export interface DailyDuplicateRow {
  id: string
  datasetId: string
  datasetName: string
  sheetName: string
  sourceRowNumber: number
  date: string
  reason: DailyDuplicateReason
  message: string
}

export interface DailyDatasetImportReport {
  datasetId: string | null
  datasetName: string
  sheetName: string
  totalRows: number
  addedRows: number
  invalidRows: number
  duplicateRows: number
  errors: string[]
}

export interface DailyImportReport {
  datasetsProcessed: number
  totalRows: number
  addedRows: number
  invalidRows: number
  duplicateRows: number
  datasetReports: DailyDatasetImportReport[]
}
