import * as XLSX from 'xlsx'
import type {
  ColumnRole,
  DailyDatasetImportReport,
  DailyDuplicateRow,
  DailyImportReport,
  DataColumn,
  Dataset,
  DatasetUpdateReport,
  MasterUpdateReport,
} from '../types/market'
import { createColumn, createEmptyRow, findColumnByRole, inferRoleFromName, sortDatasetByDate, touchDataset, UNGROUPED_ID } from '../utils/dataset'
import { isoToExcelSerial, parseTimestampValue } from '../utils/dates'
import { createId } from '../utils/ids'
import { parseNumber } from '../utils/numbers'

type SheetRow = unknown[]

const DAILY_METADATA_SHEET = '__Daily_Metadata'
const DAILY_FORMAT_VERSION = '1'

interface DailySheetMetadata {
  datasetId: string
  datasetName: string
  sheetName: string
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeSheetName(name: string, used: Set<string>) {
  const base = (name || 'Dataset').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Dataset'
  let candidate = base
  let index = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` ${index}`
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function isNumericRole(role: ColumnRole) {
  return role === 'Open' || role === 'High' || role === 'Low' || role === 'Close' || role === 'Volume' || role === 'Value'
}

export function createDatasetSheet(dataset: Dataset) {
  const rows = dataset.rows.filter((row) => dataset.columns.some((column) => row[column.id]?.trim()))
  const data = [
    dataset.columns.map((column) => column.name),
    ...rows.map((row) => dataset.columns.map((column) => {
      const rawValue = row[column.id] ?? ''
      if (column.role === 'Date') return isoToExcelSerial(rawValue) ?? rawValue
      if (isNumericRole(column.role)) return parseNumber(rawValue) ?? rawValue
      return rawValue
    })),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(data)

  dataset.columns.forEach((column, columnIndex) => {
    if (column.role !== 'Date') return
    for (let rowIndex = 1; rowIndex < data.length; rowIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })]
      if (cell?.t === 'n') {
        const sourceValue = rows[rowIndex - 1]?.[column.id] ?? ''
        cell.z = sourceValue.includes('T') ? 'dd-mm-yy hh:mm:ss' : 'dd-mm-yy'
      }
    }
  })

  sheet['!cols'] = dataset.columns.map((column) => ({ wch: column.role === 'Date' ? 13 : 15 }))
  return sheet
}

export function downloadDatasetExcel(dataset: Dataset) {
  const workbook = XLSX.utils.book_new()
  const sheet = createDatasetSheet(dataset)
  XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(dataset.name, new Set()))
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  downloadBlob(`${dataset.name || 'Dataset'}.xlsx`, new Blob([output]))
}

export function downloadMasterExcel(datasets: Dataset[]) {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  datasets.forEach((dataset) => {
    const sheet = createDatasetSheet(dataset)
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(dataset.name, used))
  })
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  downloadBlob('Market_Data_Master.xlsx', new Blob([output]))
}

function createDailyDatasetSheet(dataset: Dataset) {
  const sheet = XLSX.utils.aoa_to_sheet([dataset.columns.map((column) => column.name)])
  sheet['!cols'] = dataset.columns.map((column) => ({ wch: column.role === 'Date' ? 13 : 15 }))
  if (dataset.columns.length > 0) {
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: dataset.columns.length - 1 } }),
    }
  }
  return sheet
}

export function createDailyMasterWorkbook(datasets: Dataset[]) {
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>([DAILY_METADATA_SHEET.toLowerCase()])
  const metadata: SheetRow[] = [['formatVersion', 'datasetId', 'datasetName', 'sheetName']]

  datasets.forEach((dataset) => {
    const sheetName = safeSheetName(dataset.name, used)
    XLSX.utils.book_append_sheet(workbook, createDailyDatasetSheet(dataset), sheetName)
    metadata.push([DAILY_FORMAT_VERSION, dataset.id, dataset.name, sheetName])
  })

  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(metadata), DAILY_METADATA_SHEET)
  workbook.Workbook = workbook.Workbook ?? {}
  workbook.Workbook.Sheets = workbook.SheetNames.map((name) => ({
    name,
    Hidden: name === DAILY_METADATA_SHEET ? 1 : 0,
  }))
  return workbook
}

export function downloadDailyMasterExcel(datasets: Dataset[]) {
  const output = XLSX.write(createDailyMasterWorkbook(datasets), { type: 'array', bookType: 'xlsx' })
  downloadBlob('Market_Data_Daily.xlsx', new Blob([output]))
}

export async function readWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  return XLSX.read(buffer, { cellDates: false, cellNF: true })
}

export function readSheetRows(sheet: XLSX.WorkSheet): SheetRow[] {
  return XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  })
}

export function workbookDateOptions(workbook: XLSX.WorkBook) {
  return { date1904: Boolean(workbook.Workbook?.WBProps?.date1904) }
}

function readDailyMetadata(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase() === DAILY_METADATA_SHEET.toLowerCase())
  if (!sheetName) return new Map<string, DailySheetMetadata>()
  const rows = readSheetRows(workbook.Sheets[sheetName])
  const header = rows[0]?.map((value) => String(value ?? '').trim()) ?? []
  const versionIndex = header.indexOf('formatVersion')
  const datasetIdIndex = header.indexOf('datasetId')
  const datasetNameIndex = header.indexOf('datasetName')
  const sheetNameIndex = header.indexOf('sheetName')
  const result = new Map<string, DailySheetMetadata>()

  if (versionIndex < 0 || datasetIdIndex < 0 || datasetNameIndex < 0 || sheetNameIndex < 0) return result
  rows.slice(1).forEach((row) => {
    if (String(row[versionIndex] ?? '').trim() !== DAILY_FORMAT_VERSION) return
    const item = {
      datasetId: String(row[datasetIdIndex] ?? '').trim(),
      datasetName: String(row[datasetNameIndex] ?? '').trim(),
      sheetName: String(row[sheetNameIndex] ?? '').trim(),
    }
    if (item.datasetId && item.sheetName) result.set(item.sheetName.toLowerCase(), item)
  })
  return result
}

function dailyDuplicate(
  dataset: Dataset,
  sheetName: string,
  sourceRowNumber: number,
  date: string,
  reason: DailyDuplicateRow['reason'],
): DailyDuplicateRow {
  const message = reason === 'existing'
    ? 'Date already exists in the dataset. Existing data was preserved.'
    : 'Date appears more than once in this Daily file. All repeated rows were skipped.'
  return {
    id: `${dataset.id}:${sheetName}:${sourceRowNumber}:${date}:${reason}`,
    datasetId: dataset.id,
    datasetName: dataset.name,
    sheetName,
    sourceRowNumber,
    date,
    reason,
    message,
  }
}

function emptyDailyDatasetReport(
  sheetName: string,
  dataset?: Dataset,
): DailyDatasetImportReport {
  return {
    datasetId: dataset?.id ?? null,
    datasetName: dataset?.name ?? sheetName,
    sheetName,
    totalRows: 0,
    addedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    errors: [],
  }
}

function dailyDateKey(timestamp: string) {
  return timestamp.slice(0, 10)
}

function importDailySheet(
  dataset: Dataset,
  sheetName: string,
  sheetRows: SheetRow[],
  dateOptions: { date1904?: boolean },
) {
  const report = emptyDailyDatasetReport(sheetName, dataset)
  const duplicates: DailyDuplicateRow[] = []
  const nonEmptyRows = sheetRows.filter((row) => row.some((cell) => String(cell ?? '').trim()))
  if (nonEmptyRows.length === 0) {
    report.errors.push('Missing header row.')
    return { dataset, report, duplicates }
  }

  const header = nonEmptyRows[0].map((value) => String(value ?? '').trim())
  const sourceRows = nonEmptyRows.slice(1)
  report.totalRows = sourceRows.length
  const schemaMatches = header.length === dataset.columns.length && dataset.columns.every(
    (column, index) => column.name.trim().toLowerCase() === header[index]?.toLowerCase(),
  )
  if (!schemaMatches) {
    report.invalidRows = sourceRows.length
    report.errors.push('Sheet columns do not match the current dataset schema.')
    return { dataset, report, duplicates }
  }

  const dateIndex = dataset.columns.findIndex((column) => column.role === 'Date')
  const timeIndex = dataset.columns.findIndex((column) => column.role === 'Time')
  if (dateIndex < 0) {
    report.invalidRows = sourceRows.length
    report.errors.push('Current dataset does not have a Date column.')
    return { dataset, report, duplicates }
  }

  const dateColumn = dataset.columns[dateIndex]
  const timeColumn = timeIndex >= 0 ? dataset.columns[timeIndex] : undefined
  const existingRows = dataset.rows.filter((row) => dataset.columns.some((column) => row[column.id]?.trim()))
  const existingDateKeys = new Set<string>()
  existingRows.forEach((row) => {
    const timestamp = parseTimestampValue(
      row[dateColumn.id] ?? '',
      timeColumn ? row[timeColumn.id] : undefined,
      dateOptions,
    )
    if (timestamp) existingDateKeys.add(dailyDateKey(timestamp))
  })

  const datedRows: Array<{ sourceRow: SheetRow; sourceRowNumber: number; timestamp: string; dateKey: string }> = []
  sourceRows.forEach((sourceRow, index) => {
    const sourceRowNumber = index + 2
    const timestamp = parseTimestampValue(
      sourceRow[dateIndex],
      timeIndex >= 0 ? sourceRow[timeIndex] : undefined,
      dateOptions,
    )
    if (!timestamp) {
      report.invalidRows += 1
      if (report.errors.length < 20) report.errors.push(`Invalid or missing Date at row ${sourceRowNumber}.`)
      return
    }
    datedRows.push({ sourceRow, sourceRowNumber, timestamp, dateKey: dailyDateKey(timestamp) })
  })

  const incomingByDate = new Map<string, typeof datedRows>()
  datedRows.forEach((item) => {
    const group = incomingByDate.get(item.dateKey) ?? []
    group.push(item)
    incomingByDate.set(item.dateKey, group)
  })

  const pendingRows: Record<string, string>[] = []
  incomingByDate.forEach((items, dateKey) => {
    if (existingDateKeys.has(dateKey)) {
      items.forEach((item) => duplicates.push(
        dailyDuplicate(dataset, sheetName, item.sourceRowNumber, dateKey, 'existing'),
      ))
      return
    }
    if (items.length > 1) {
      items.forEach((item) => duplicates.push(
        dailyDuplicate(dataset, sheetName, item.sourceRowNumber, dateKey, 'incoming'),
      ))
      return
    }

    const item = items[0]
    const row = createEmptyRow(dataset.columns)
    let invalidNumericColumn = ''
    dataset.columns.forEach((column, columnIndex) => {
      const rawValue = item.sourceRow[columnIndex]
      if (column.role === 'Date') {
        row[column.id] = item.timestamp
        return
      }
      const textValue = String(rawValue ?? '').trim()
      if (!isNumericRole(column.role)) {
        row[column.id] = textValue
        return
      }
      const numeric = parseNumber(textValue)
      if (numeric === null) {
        if (column.role !== 'Volume') invalidNumericColumn ||= column.name
        return
      }
      row[column.id] = String(numeric)
    })
    if (invalidNumericColumn) {
      report.invalidRows += 1
      if (report.errors.length < 20) {
        report.errors.push(`Invalid or missing number in "${invalidNumericColumn}" at row ${item.sourceRowNumber}.`)
      }
      return
    }
    pendingRows.push(row)
  })

  report.duplicateRows = duplicates.length
  report.addedRows = pendingRows.length
  if (pendingRows.length === 0) return { dataset, report, duplicates }
  const nextDataset = sortDatasetByDate(
    touchDataset({ ...dataset, rows: [...existingRows, ...pendingRows] }),
    'asc',
  )
  return { dataset: nextDataset, report, duplicates }
}

export function importDailyWorkbook(datasets: Dataset[], workbook: XLSX.WorkBook) {
  const metadata = readDailyMetadata(workbook)
  const dateOptions = workbookDateOptions(workbook)
  let nextDatasets = [...datasets]
  const datasetReports: DailyDatasetImportReport[] = []
  const duplicates: DailyDuplicateRow[] = []
  const datasetsById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
  const datasetsByName = new Map(datasets.map((dataset) => [dataset.name.trim().toLowerCase(), dataset]))

  workbook.SheetNames
    .filter((sheetName) => sheetName.toLowerCase() !== DAILY_METADATA_SHEET.toLowerCase())
    .forEach((sheetName) => {
      const sheetMetadata = metadata.get(sheetName.toLowerCase())
      const dataset =
        (sheetMetadata?.datasetId ? datasetsById.get(sheetMetadata.datasetId) : undefined) ??
        (sheetMetadata?.datasetName ? datasetsByName.get(sheetMetadata.datasetName.toLowerCase()) : undefined) ??
        datasetsByName.get(sheetName.trim().toLowerCase())
      if (!dataset) {
        const report = emptyDailyDatasetReport(sheetName)
        const rows = readSheetRows(workbook.Sheets[sheetName])
        report.totalRows = Math.max(rows.filter((row) => row.some((cell) => String(cell ?? '').trim())).length - 1, 0)
        report.invalidRows = report.totalRows
        report.errors.push('No current dataset matches this sheet metadata.')
        datasetReports.push(report)
        return
      }

      const result = importDailySheet(dataset, sheetName, readSheetRows(workbook.Sheets[sheetName]), dateOptions)
      datasetReports.push(result.report)
      duplicates.push(...result.duplicates)
      if (result.report.addedRows > 0) {
        nextDatasets = nextDatasets.map((item) => item.id === dataset.id ? result.dataset : item)
        datasetsById.set(dataset.id, result.dataset)
        datasetsByName.set(dataset.name.trim().toLowerCase(), result.dataset)
      }
    })

  const report: DailyImportReport = {
    datasetsProcessed: datasetReports.length,
    totalRows: datasetReports.reduce((sum, item) => sum + item.totalRows, 0),
    addedRows: datasetReports.reduce((sum, item) => sum + item.addedRows, 0),
    invalidRows: datasetReports.reduce((sum, item) => sum + item.invalidRows, 0),
    duplicateRows: datasetReports.reduce((sum, item) => sum + item.duplicateRows, 0),
    datasetReports,
  }
  return { datasets: nextDatasets, report, duplicates }
}

function normalizeHeaderCell(value: unknown, index: number) {
  const name = String(value ?? '').trim()
  return name || `Field ${index + 1}`
}

function buildColumnPlan(dataset: Dataset, header: string[]) {
  const columns = [...dataset.columns]
  const dateColumn = findColumnByRole(dataset, 'Date')
  const matchedColumns: DataColumn[] = []

  header.forEach((name, index) => {
    const role = inferRoleFromName(name, index)
    const existing =
      (role !== 'Other' && columns.find((column) => column.role === role)) ||
      columns.find((column) => column.name.trim().toLowerCase() === name.trim().toLowerCase())

    if (existing) {
      matchedColumns.push(existing)
      return
    }

    const created = createColumn(name, role)
    columns.push(created)
    matchedColumns.push(created)
  })

  if (!matchedColumns.some((column) => column.role === 'Date')) {
    if (dateColumn) matchedColumns[0] = dateColumn
  }

  return { columns, matchedColumns }
}

function rowsEqualForColumns(a: Record<string, string>, b: Record<string, string>, columns: DataColumn[]) {
  return columns.every((column) => (a[column.id] ?? '') === (b[column.id] ?? ''))
}

export function upsertDatasetFromRows(
  dataset: Dataset,
  sheetRows: SheetRow[],
  fallbackName = dataset.name,
  dateOptions: { date1904?: boolean } = {},
): { dataset: Dataset; report: DatasetUpdateReport } {
  const report: DatasetUpdateReport = {
    datasetName: fallbackName,
    totalRows: 0,
    importedRows: 0,
    invalidRows: 0,
    duplicateDates: 0,
    earliestDate: null,
    latestDate: null,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  }

  const nonEmptyRows = sheetRows.filter((row) => row.some((cell) => String(cell ?? '').trim()))
  if (nonEmptyRows.length === 0) {
    return { dataset, report }
  }
  report.totalRows = Math.max(nonEmptyRows.length - 1, 0)

  const header = nonEmptyRows[0].map(normalizeHeaderCell)
  const dateIndex = header.findIndex((name, index) => inferRoleFromName(name, index) === 'Date')
  if (dateIndex < 0) {
    report.errors.push('Missing Date column.')
    report.invalidRows = report.totalRows
    return { dataset, report }
  }

  const { columns, matchedColumns } = buildColumnPlan(dataset, header)
  const dateColumn = matchedColumns[dateIndex]
  const timeIndex = header.findIndex((name, index) => inferRoleFromName(name, index) === 'Time')
  const timeColumn = timeIndex >= 0 ? matchedColumns[timeIndex] : findColumnByRole(dataset, 'Time')
  const rows = dataset.rows
    .filter((row) => dataset.columns.some((column) => row[column.id]?.trim()))
    .map((row) => ({ ...createEmptyRow(columns), ...row }))
  const existingByDate = new Map<string, number>()

  rows.forEach((row, index) => {
    const iso = parseTimestampValue(
      row[dateColumn.id] ?? '',
      timeColumn ? row[timeColumn.id] : undefined,
      dateOptions,
    )
    if (iso) {
      row[dateColumn.id] = iso
      existingByDate.set(iso, index)
    }
    columns.forEach((column) => {
      if (!isNumericRole(column.role)) return
      const numeric = parseNumber(row[column.id] ?? '')
      if (numeric !== null) row[column.id] = String(numeric)
    })
  })

  const pendingRows: Array<{ iso: string; row: Record<string, string> }> = []
  const sourceDates = new Set<string>()

  nonEmptyRows.slice(1).forEach((sourceRow, index) => {
    const sourceRowNumber = index + 2
    const iso = parseTimestampValue(
      sourceRow[dateIndex],
      timeIndex >= 0 ? sourceRow[timeIndex] : undefined,
      dateOptions,
    )
    if (!iso) {
      report.invalidRows += 1
      if (report.errors.length < 20) report.errors.push(`Invalid date at row ${sourceRowNumber}.`)
      return
    }
    if (sourceDates.has(iso)) {
      report.duplicateDates += 1
      return
    }
    sourceDates.add(iso)

    const row = createEmptyRow(columns)
    let invalidRequiredNumericColumn = ''
    matchedColumns.forEach((column, columnIndex) => {
      const rawValue = sourceRow[columnIndex]
      if (column.role === 'Date') {
        row[column.id] = iso
        return
      }
      const textValue = String(rawValue ?? '').trim()
      if (isNumericRole(column.role) && textValue) {
        const numeric = parseNumber(textValue)
        if (numeric === null) {
          if (['Open', 'High', 'Low', 'Close'].includes(column.role)) {
            invalidRequiredNumericColumn = column.name
          }
        } else {
          row[column.id] = String(numeric)
        }
        return
      }
      row[column.id] = textValue
    })
    if (invalidRequiredNumericColumn) {
      report.invalidRows += 1
      if (report.errors.length < 20) {
        report.errors.push(`Invalid number in "${invalidRequiredNumericColumn}" at row ${sourceRowNumber}.`)
      }
      return
    }
    pendingRows.push({ iso, row })
  })

  report.importedRows = pendingRows.length
  const importedDates = pendingRows.map((item) => item.iso).sort()
  report.earliestDate = importedDates[0] ?? null
  report.latestDate = importedDates.at(-1) ?? null

  pendingRows.forEach(({ iso, row }) => {
    const existingIndex = existingByDate.get(iso)
    if (existingIndex === undefined) {
      existingByDate.set(iso, rows.length)
      rows.push(row)
      report.inserted += 1
      return
    }

    const merged = { ...rows[existingIndex], ...row }
    if (rowsEqualForColumns(rows[existingIndex], merged, matchedColumns)) {
      report.unchanged += 1
    } else {
      rows[existingIndex] = merged
      report.updated += 1
    }
  })

  return {
    dataset: sortDatasetByDate(touchDataset({ ...dataset, columns, rows }), 'asc'),
    report,
  }
}

export function createDatasetFromSheet(name: string, sheetRows: SheetRow[]) {
  const header = sheetRows[0]?.map(normalizeHeaderCell) ?? ['Date', 'Close']
  const columns = header.map((columnName, index) => createColumn(columnName, inferRoleFromName(columnName, index)))
  return {
    id: createId('dataset'),
    name,
    groupId: UNGROUPED_ID,
    columns,
    rows: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } satisfies Dataset
}

export function upsertMasterWorkbook(datasets: Dataset[], workbook: XLSX.WorkBook) {
  let nextDatasets = [...datasets]
  const reports: DatasetUpdateReport[] = []
  const byName = new Map(nextDatasets.map((dataset) => [dataset.name.trim().toLowerCase(), dataset]))

  workbook.SheetNames.forEach((sheetName) => {
    const rows = readSheetRows(workbook.Sheets[sheetName])
    const existing = byName.get(sheetName.trim().toLowerCase())
    const target = existing ?? createDatasetFromSheet(sheetName, rows)
    const result = upsertDatasetFromRows(target, rows, sheetName, workbookDateOptions(workbook))
    reports.push(result.report)

    if (result.report.importedRows === 0 && result.report.errors.length > 0) return

    if (existing) {
      nextDatasets = nextDatasets.map((dataset) =>
        dataset.id === existing.id ? result.dataset : dataset,
      )
    } else {
      nextDatasets.push(result.dataset)
      byName.set(sheetName.trim().toLowerCase(), result.dataset)
    }
  })

  const report: MasterUpdateReport = {
    datasetsProcessed: reports.length,
    totalRows: reports.reduce((sum, item) => sum + item.totalRows, 0),
    importedRows: reports.reduce((sum, item) => sum + item.importedRows, 0),
    invalidRows: reports.reduce((sum, item) => sum + item.invalidRows, 0),
    duplicateDates: reports.reduce((sum, item) => sum + item.duplicateDates, 0),
    earliestDate: reports.map((item) => item.earliestDate).filter((date): date is string => Boolean(date)).sort()[0] ?? null,
    latestDate: reports.map((item) => item.latestDate).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
    inserted: reports.reduce((sum, item) => sum + item.inserted, 0),
    updated: reports.reduce((sum, item) => sum + item.updated, 0),
    unchanged: reports.reduce((sum, item) => sum + item.unchanged, 0),
    errors: reports.reduce((sum, item) => sum + item.invalidRows, 0),
    datasetReports: reports,
  }

  return { datasets: nextDatasets, report }
}
