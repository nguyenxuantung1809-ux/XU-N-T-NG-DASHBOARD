import type { CellIssue, Dataset, DatasetValidation, ParsedPoint } from '../types/market'
import { findColumnByRole, numericColumns } from './dataset'
import { formatIsoToDdMmYyyy, formatTimestampLabel, parseTimestampValue } from './dates'
import { parseNumber } from './numbers'

function cellKey(rowIndex: number, columnId: string) {
  return `${rowIndex}:${columnId}`
}

function addIssue(
  cellIssues: Map<string, CellIssue>,
  summary: CellIssue[],
  rowIndex: number,
  columnId: string,
  message: string,
  severity: CellIssue['severity'] = 'error',
) {
  const issue = { key: cellKey(rowIndex, columnId), message, severity }
  cellIssues.set(issue.key, issue)
  summary.push(issue)
}

export function validateDataset(dataset: Dataset): DatasetValidation {
  const cellIssues = new Map<string, CellIssue>()
  const summary: CellIssue[] = []
  const dateColumn = findColumnByRole(dataset, 'Date')
  const timeColumn = findColumnByRole(dataset, 'Time')
  const seenDates = new Map<string, number>()
  const valueColumns = numericColumns(dataset)

  dataset.rows.forEach((row, rowIndex) => {
    const hasAnyData = dataset.columns.some((column) => row[column.id]?.trim())
    if (!hasAnyData) return

    if (!dateColumn) {
      summary.push({
        key: `dataset:${dataset.id}:date`,
        message: 'Dataset needs one Date role column.',
        severity: 'error',
      })
      return
    }

    const dateValue = row[dateColumn.id] ?? ''
    const iso = parseTimestampValue(dateValue, timeColumn ? row[timeColumn.id] : undefined)
    if (!iso) {
      addIssue(cellIssues, summary, rowIndex, dateColumn.id, 'Date must be dd/mm/yyyy, dd-mm-yyyy, dd/mm/yy, or dd-mm-yy.')
    } else if (seenDates.has(iso)) {
      addIssue(
        cellIssues,
        summary,
        rowIndex,
        dateColumn.id,
        `Duplicate date ${formatIsoToDdMmYyyy(iso)}.`,
        'warning',
      )
    } else {
      seenDates.set(iso, rowIndex)
    }

    let numericValues = 0
    valueColumns.forEach((column) => {
      const value = row[column.id] ?? ''
      if (!value.trim()) return

      if (parseNumber(value) === null) {
        addIssue(cellIssues, summary, rowIndex, column.id, 'Expected a number.')
      } else {
        numericValues += 1
      }
    })

    if (numericValues === 0) {
      summary.push({
        key: `row:${rowIndex}:numeric`,
        message: `Row ${rowIndex + 1} needs at least one numeric value.`,
        severity: 'warning',
      })
    }

    const openColumn = findColumnByRole(dataset, 'Open')
    const highColumn = findColumnByRole(dataset, 'High')
    const lowColumn = findColumnByRole(dataset, 'Low')
    const closeColumn = findColumnByRole(dataset, 'Close')
    if (!openColumn || !highColumn || !lowColumn || !closeColumn) return

    const open = parseNumber(row[openColumn.id] ?? '')
    const high = parseNumber(row[highColumn.id] ?? '')
    const low = parseNumber(row[lowColumn.id] ?? '')
    const close = parseNumber(row[closeColumn.id] ?? '')
    if ([open, high, low, close].some((value) => value === null)) return

    if (high! < Math.max(open!, low!, close!)) {
      addIssue(cellIssues, summary, rowIndex, highColumn.id, 'High must be >= Open, Low, Close.')
    }

    if (low! > Math.min(open!, high!, close!)) {
      addIssue(cellIssues, summary, rowIndex, lowColumn.id, 'Low must be <= Open, High, Close.')
    }
  })

  return { cellIssues, summary }
}

export function toParsedPoints(dataset: Dataset): ParsedPoint[] {
  const dateColumn = findColumnByRole(dataset, 'Date')
  const timeColumn = findColumnByRole(dataset, 'Time')
  if (!dateColumn) return []

  return dataset.rows
    .map((row) => {
      const dateIso = parseTimestampValue(
        row[dateColumn.id] ?? '',
        timeColumn ? row[timeColumn.id] : undefined,
      )
      if (!dateIso) return null

      const values: Record<string, number> = {}
      dataset.columns.forEach((column) => {
        if (column.role === 'Date') return
        const number = parseNumber(row[column.id] ?? '')
        if (number !== null) values[column.id] = number
      })

      return {
        dateIso,
        dateLabel: formatTimestampLabel(dateIso),
        values,
      }
    })
    .filter((point): point is ParsedPoint => Boolean(point))
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
}
