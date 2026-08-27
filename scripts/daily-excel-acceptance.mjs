import assert from 'node:assert/strict'
import { createServer } from 'vite'
import * as XLSX from 'xlsx'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })

try {
  const {
    createDailyMasterWorkbook,
    importDailyWorkbook,
    readSheetRows,
    upsertMasterWorkbook,
  } = await vite.ssrLoadModule('/src/services/excelService.ts')

  const columns = [
    { id: 'date', name: 'Date', role: 'Date' },
    { id: 'open', name: 'Open', role: 'Open' },
    { id: 'high', name: 'High', role: 'High' },
    { id: 'low', name: 'Low', role: 'Low' },
    { id: 'close', name: 'Close', role: 'Close' },
    { id: 'volume', name: 'Volume', role: 'Volume' },
  ]
  const dataset = (id, name, rows) => ({
    id,
    name,
    groupId: 'group-1',
    order: 1,
    columns,
    rows,
    createdAt: 1,
    updatedAt: 1,
  })
  const row = (date, close, open = close, high = close, low = close, volume = '100') => ({
    date,
    open: String(open),
    high: String(high),
    low: String(low),
    close: String(close),
    volume: String(volume),
  })
  const base = [
    dataset('gold-id', 'Gold', [row('2026-08-20', 100), row('2026-08-22', 102)]),
    dataset('silver-id', 'Silver', [row('2026-08-20', 20)]),
  ]
  const dataSheets = (workbook) => workbook.SheetNames.filter((name) => name !== '__Daily_Metadata')
  const addRows = (workbook, sheetName, rows) => {
    XLSX.utils.sheet_add_aoa(workbook.Sheets[sheetName], rows, { origin: -1 })
  }

  const generated = createDailyMasterWorkbook(base)
  assert.equal(dataSheets(generated).length, 2, '1. Daily workbook contains every dataset')
  dataSheets(generated).forEach((sheetName, index) => {
    const rows = readSheetRows(generated.Sheets[sheetName])
    assert.deepEqual(rows[0], base[index].columns.map((column) => column.name), '2. Header matches dataset schema')
    assert.equal(rows.length, 1, '3. Daily template contains no historical data')
  })

  const latest = createDailyMasterWorkbook(base)
  const latestGoldSheet = dataSheets(latest)[0]
  addRows(latest, latestGoldSheet, [['24/08/2026', 104, 105, 103, 104.5, '1.2K']])
  latest.SheetNames = ['Silver', '__Daily_Metadata', 'Gold']
  const latestResult = importDailyWorkbook(base, latest)
  assert.equal(latestResult.report.addedRows, 1, '4. Latest date imports')
  assert.equal(latestResult.datasets[0].rows.at(-1).date, '2026-08-24', '4. Dataset matching ignores sheet order')

  const historical = createDailyMasterWorkbook(base)
  addRows(historical, dataSheets(historical)[0], [['21-08-2026', 101, 102, 100, 101.5, 100]])
  const historicalResult = importDailyWorkbook(base, historical)
  assert.deepEqual(
    historicalResult.datasets[0].rows.map((item) => item.date),
    ['2026-08-20', '2026-08-21', '2026-08-22'],
    '5. Missing historical date inserts and sorts ascending',
  )

  const existingDuplicate = createDailyMasterWorkbook(base)
  addRows(existingDuplicate, dataSheets(existingDuplicate)[0], [['22/08/2026', 999, 999, 999, 999, 999]])
  const existingDuplicateResult = importDailyWorkbook(base, existingDuplicate)
  assert.equal(existingDuplicateResult.report.duplicateRows, 1, '6. Existing date is reported as duplicate')
  assert.equal(existingDuplicateResult.datasets[0].rows[1].close, '102', '6. Existing values cannot be overwritten')

  const incomingDuplicate = createDailyMasterWorkbook(base)
  addRows(incomingDuplicate, dataSheets(incomingDuplicate)[0], [
    ['23/08/2026', 103, 104, 102, 103, 100],
    ['2026-08-23', 203, 204, 202, 203, 200],
  ])
  const incomingDuplicateResult = importDailyWorkbook(base, incomingDuplicate)
  assert.equal(incomingDuplicateResult.duplicates.length, 2, '7. Every repeated incoming row is flagged')
  assert.equal(incomingDuplicateResult.report.addedRows, 0, '7. Repeated incoming date is not imported')

  const mixed = createDailyMasterWorkbook(base)
  addRows(mixed, dataSheets(mixed)[0], [
    ['23/08/2026', 103, 104, 102, 103, 100],
    ['22/08/2026', 999, 999, 999, 999, 999],
  ])
  const mixedResult = importDailyWorkbook(base, mixed)
  assert.equal(mixedResult.report.addedRows, 1, '8. Valid row imports beside duplicate row')
  assert.equal(mixedResult.report.duplicateRows, 1, '8. Duplicate remains reported')

  const many = createDailyMasterWorkbook(base)
  const manyRows = Array.from({ length: 1000 }, (_, index) => {
    const date = new Date(Date.UTC(2030, 0, 1 + index)).toISOString().slice(0, 10)
    return [date, 100 + index, 101 + index, 99 + index, 100.5 + index, 1000 + index]
  })
  addRows(many, dataSheets(many)[1], manyRows)
  const manyResult = importDailyWorkbook(base, many)
  assert.equal(manyResult.report.addedRows, 1000, '9. Large incremental import succeeds')

  const master = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(master, XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.name),
    ['22/08/2026', 999, 999, 999, 999, 999],
  ]), 'Gold')
  const masterResult = upsertMasterWorkbook(base, master)
  assert.equal(masterResult.report.updated, 1, '10. Existing Master update behavior still works')
  assert.equal(masterResult.datasets[0].rows[1].close, '999', '10. Master can still update existing data')

  console.log('Daily Excel acceptance: 10/10 PASS')
} finally {
  await vite.close()
}
