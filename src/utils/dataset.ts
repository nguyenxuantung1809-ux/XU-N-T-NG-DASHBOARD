import type { ColumnRole, Dataset, DataColumn, DataRow, DatasetGroup, SortDirection } from '../types/market'
import { compareDateText } from './dates'
import { createId } from './ids'

export const UNGROUPED_ID = 'group-ungrouped'

export const DEFAULT_COLUMNS: Array<[string, ColumnRole]> = [
  ['Date', 'Date'],
  ['Open', 'Open'],
  ['High', 'High'],
  ['Low', 'Low'],
  ['Close', 'Close'],
]

export function createColumn(name: string, role: ColumnRole = 'Other'): DataColumn {
  return { id: createId('col'), name, role }
}

export function createEmptyRow(columns: DataColumn[]): DataRow {
  return Object.fromEntries(columns.map((column) => [column.id, '']))
}

export function createGroup(name = 'New Group'): DatasetGroup {
  return {
    id: createId('group'),
    name,
    order: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function createUngroupedGroup(): DatasetGroup {
  return {
    id: UNGROUPED_ID,
    name: 'Ungrouped',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

export function createDataset(name = 'Dataset', groupId = UNGROUPED_ID): Dataset {
  const columns = DEFAULT_COLUMNS.map(([columnName, role]) => createColumn(columnName, role))
  return {
    id: createId('dataset'),
    name,
    groupId,
    order: Date.now(),
    columns,
    rows: Array.from({ length: 24 }, () => createEmptyRow(columns)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function duplicateDataset(dataset: Dataset): Dataset {
  const columnMap = new Map<string, string>()
  const columns = dataset.columns.map((column) => {
    const id = createId('col')
    columnMap.set(column.id, id)
    return { ...column, id }
  })

  return {
    ...dataset,
    id: createId('dataset'),
    name: `${dataset.name} Copy`,
    groupId: dataset.groupId ?? UNGROUPED_ID,
    order: Date.now(),
    columns,
    rows: dataset.rows.map((row) =>
      Object.fromEntries(dataset.columns.map((column) => [columnMap.get(column.id)!, row[column.id] ?? ''])),
    ),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function touchDataset(dataset: Dataset): Dataset {
  return { ...dataset, updatedAt: Date.now() }
}

export function findColumnByRole(dataset: Dataset, role: ColumnRole) {
  return dataset.columns.find((column) => column.role === role)
}

export function inferRoleFromName(name: string, _index: number): ColumnRole {
  const normalized = name.trim().toLowerCase().replace(/[._-]+/g, ' ').trim()
  if (
    normalized === 'date' ||
    normalized === 'datetime' ||
    normalized === 'timestamp' ||
    normalized === 'ngày'
  ) return 'Date'
  if (normalized === 'time' || normalized === 'giờ') return 'Time'
  if (normalized === 'open') return 'Open'
  if (normalized === 'high') return 'High'
  if (normalized === 'low') return 'Low'
  if (normalized === 'close' || normalized === 'price' || normalized === 'giá đóng cửa') return 'Close'
  if (normalized === 'volume' || normalized === 'vol' || normalized === 'khối lượng') return 'Volume'
  if (normalized === 'value' || normalized === 'giá trị') return 'Value'
  return 'Other'
}

export function numericColumns(dataset: Dataset) {
  return dataset.columns.filter((column) =>
    ['Open', 'High', 'Low', 'Close', 'Volume', 'Value'].includes(column.role),
  )
}

export function hasOhlc(dataset: Dataset) {
  return ['Open', 'High', 'Low', 'Close'].every((role) =>
    dataset.columns.some((column) => column.role === role),
  )
}

export function sortDatasetByDate(dataset: Dataset, direction: SortDirection): Dataset {
  const dateColumn = findColumnByRole(dataset, 'Date')
  if (!dateColumn) return dataset

  const rows = [...dataset.rows].sort((a, b) => {
    const result = compareDateText(a[dateColumn.id] ?? '', b[dateColumn.id] ?? '')
    return direction === 'asc' ? result : -result
  })

  return touchDataset({ ...dataset, rows })
}
