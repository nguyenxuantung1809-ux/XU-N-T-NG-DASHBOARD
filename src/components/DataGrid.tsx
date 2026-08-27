import { useVirtualizer } from '@tanstack/react-virtual'
import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { ColumnRole, DataColumn, Dataset, SortDirection } from '../types/market'
import { createColumn, createEmptyRow, sortDatasetByDate, touchDataset } from '../utils/dataset'
import { parseClipboardTable, rowsLookLikeHeader } from '../utils/paste'
import { validateDataset } from '../utils/validation'

const ROLES: ColumnRole[] = ['Date', 'Time', 'Open', 'High', 'Low', 'Close', 'Volume', 'Value', 'Other']

interface DataGridProps {
  dataset: Dataset
  onChange: (dataset: Dataset) => void
}

export function DataGrid({ dataset, onChange }: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const validation = useMemo(() => validateDataset(dataset), [dataset])
  const rowVirtualizer = useVirtualizer({
    count: dataset.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 35,
    overscan: 12,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const paddingTop = virtualRows[0]?.start ?? 0
  const paddingBottom = virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0)
    : 0

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [dataset.id])

  function updateDataset(next: Dataset) {
    onChange(touchDataset(next))
  }

  function updateCell(rowIndex: number, columnId: string, value: string) {
    const rows = [...dataset.rows]
    rows[rowIndex] = { ...rows[rowIndex], [columnId]: value }
    updateDataset({ ...dataset, rows })
  }

  function pasteBlock(rowIndex: number, columnIndex: number, text: string) {
    const pastedRows = parseClipboardTable(text)
    if (!pastedRows.length) return

    let values = pastedRows
    let columns = dataset.columns
    const firstRow = pastedRows[0]

    if (firstRow && rowsLookLikeHeader(firstRow, dataset.columns.map((column) => column.name))) {
      values = pastedRows.slice(1)
      const nextColumns = [...columns]
      firstRow.forEach((header, offset) => {
        const targetIndex = columnIndex + offset
        const existing = nextColumns[targetIndex]
        if (existing && header.trim()) {
          nextColumns[targetIndex] = { ...existing, name: header.trim() }
        }
      })
      columns = nextColumns
    }

    while (columns.length < columnIndex + Math.max(...values.map((row) => row.length))) {
      columns = [...columns, createColumn(`Field ${columns.length + 1}`)]
    }

    const rows = [...dataset.rows]
    while (rows.length < rowIndex + values.length) {
      rows.push(createEmptyRow(columns))
    }

    const nextRows = rows.map((row) => ({ ...row }))
    values.forEach((sourceRow, rOffset) => {
      sourceRow.forEach((cell, cOffset) => {
        const column = columns[columnIndex + cOffset]
        if (column) nextRows[rowIndex + rOffset][column.id] = cell.trim()
      })
    })

    updateDataset({ ...dataset, columns, rows: nextRows })
  }

  function updateColumn(columnId: string, patch: Partial<DataColumn>) {
    updateDataset({
      ...dataset,
      columns: dataset.columns.map((column) =>
        column.id === columnId ? { ...column, ...patch } : column,
      ),
    })
  }

  function addColumn() {
    const column = createColumn(`Field ${dataset.columns.length + 1}`)
    updateDataset({
      ...dataset,
      columns: [...dataset.columns, column],
      rows: dataset.rows.map((row) => ({ ...row, [column.id]: '' })),
    })
  }

  function deleteColumn(columnId: string) {
    if (dataset.columns.length <= 1) return
    updateDataset({
      ...dataset,
      columns: dataset.columns.filter((column) => column.id !== columnId),
      rows: dataset.rows.map((row) => {
        const next = { ...row }
        delete next[columnId]
        return next
      }),
    })
  }

  function addRows(count = 20) {
    updateDataset({
      ...dataset,
      rows: [...dataset.rows, ...Array.from({ length: count }, () => createEmptyRow(dataset.columns))],
    })
  }

  function deleteRow(rowIndex: number) {
    updateDataset({
      ...dataset,
      rows: dataset.rows.filter((_, index) => index !== rowIndex),
    })
  }

  function clearData() {
    updateDataset({
      ...dataset,
      rows: Array.from({ length: 24 }, () => createEmptyRow(dataset.columns)),
    })
  }

  function sort(direction: SortDirection) {
    onChange(sortDatasetByDate(dataset, direction))
  }

  return (
    <section className="data-grid-shell">
      <div className="panel-toolbar">
        <div>
          <h2>{dataset.name}</h2>
          <p>Showing {dataset.rows.length.toLocaleString()} rows, {dataset.columns.length} columns</p>
        </div>
        <div className="toolbar-actions">
          <button type="button" onClick={addColumn}>Add Column</button>
          <button type="button" onClick={() => addRows(20)}>Add Rows</button>
          <button type="button" onClick={() => sort('asc')}>Oldest First</button>
          <button type="button" onClick={() => sort('desc')}>Newest First</button>
          <button type="button" className="ghost-danger" onClick={clearData}>Clear Data</button>
        </div>
      </div>

      {validation.summary.length > 0 && (
        <div className="validation-strip">
          <strong>{validation.summary.length} validation notes</strong>
          <span>{validation.summary.slice(0, 3).map((issue) => issue.message).join(' | ')}</span>
        </div>
      )}

      <div className="sheet-wrap" ref={scrollRef}>
        <table className="sheet">
          <thead>
            <tr>
              <th className="row-number">#</th>
              {dataset.columns.map((column) => (
                <th key={column.id}>
                  <div className="column-head">
                    <input
                      value={column.name}
                      aria-label={`Column ${column.name} name`}
                      onChange={(event) => updateColumn(column.id, { name: event.target.value })}
                    />
                    <div>
                      <select
                        value={column.role}
                        aria-label={`Column ${column.name} role`}
                        onChange={(event) =>
                          updateColumn(column.id, { role: event.target.value as ColumnRole })
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="icon-button"
                        title="Delete column"
                        onClick={() => deleteColumn(column.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </th>
              ))}
              <th className="row-actions"></th>
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr className="virtual-spacer" aria-hidden="true">
                <td colSpan={dataset.columns.length + 2} style={{ height: paddingTop }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const rowIndex = virtualRow.index
              const row = dataset.rows[rowIndex]
              return (
                <tr key={virtualRow.key}>
                  <td className="row-number">{rowIndex + 1}</td>
                  {dataset.columns.map((column, columnIndex) => {
                    const issue = validation.cellIssues.get(`${rowIndex}:${column.id}`)
                    return (
                      <td key={column.id} className={issue ? `cell-${issue.severity}` : undefined}>
                        <input
                          value={row[column.id] ?? ''}
                          title={issue?.message}
                          aria-label={`${column.name} row ${rowIndex + 1}`}
                          onChange={(event) => updateCell(rowIndex, column.id, event.target.value)}
                          onPaste={(event) => {
                            const text = event.clipboardData.getData('text/plain')
                            if (text.includes('\t') || text.includes('\n')) {
                              event.preventDefault()
                              pasteBlock(rowIndex, columnIndex, text)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Delete') updateCell(rowIndex, column.id, '')
                          }}
                        />
                      </td>
                    )
                  })}
                  <td className="row-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="Delete row"
                      onClick={() => deleteRow(rowIndex)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr className="virtual-spacer" aria-hidden="true">
                <td colSpan={dataset.columns.length + 2} style={{ height: paddingBottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
