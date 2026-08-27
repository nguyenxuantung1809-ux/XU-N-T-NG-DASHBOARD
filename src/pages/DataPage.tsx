import {
  BarChart3,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FolderPlus,
  GripVertical,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  DailyDuplicateRow,
  DailyImportReport,
  Dataset,
  DatasetGroup,
  MasterUpdateReport,
} from '../types/market'
import { DataGrid } from '../components/DataGrid'
import {
  createDataset,
  createGroup,
  createUngroupedGroup,
  duplicateDataset,
  touchDataset,
  UNGROUPED_ID,
} from '../utils/dataset'
import {
  downloadDatasetExcel,
  downloadDailyMasterExcel,
  downloadMasterExcel,
  importDailyWorkbook,
  readSheetRows,
  readWorkbook,
  upsertDatasetFromRows,
  upsertMasterWorkbook,
  workbookDateOptions,
} from '../services/excelService'
import { formatIsoToDdMmYy } from '../utils/dates'
import { buildMarketData } from '../utils/marketChartData'

interface DataPageProps {
  datasets: Dataset[]
  groups: DatasetGroup[]
  collapsedGroupIds: string[]
  activeDatasetId: string
  onViewChart: (datasetId: string) => void
  onWorkspaceChange: (patch: {
    datasets?: Dataset[]
    groups?: DatasetGroup[]
    collapsedGroupIds?: string[]
    activeDatasetId?: string
  }) => void
}

export function DataPage({
  datasets,
  groups,
  collapsedGroupIds,
  activeDatasetId,
  onWorkspaceChange,
  onViewChart,
}: DataPageProps) {
  const [draggedDatasetId, setDraggedDatasetId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ groupId: string; beforeId?: string; afterId?: string } | null>(null)
  const [dailyImportResult, setDailyImportResult] = useState<{
    report: DailyImportReport
    duplicates: DailyDuplicateRow[]
  } | null>(null)
  const activeDataset = datasets.find((dataset) => dataset.id === activeDatasetId) ?? datasets[0]
  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [groups],
  )
  const orderedDatasets = useMemo(
    () => [...datasets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [datasets],
  )

  function setDatasets(nextDatasets: Dataset[], nextActiveDatasetId = activeDatasetId) {
    onWorkspaceChange({ datasets: nextDatasets, activeDatasetId: nextActiveDatasetId })
  }

  function updateDataset(next: Dataset) {
    setDatasets(datasets.map((dataset) => (dataset.id === next.id ? next : dataset)))
  }

  function addDataset(requestedGroupId?: string) {
    let nextGroups = groups
    let groupId = requestedGroupId ?? activeDataset?.groupId ?? orderedGroups[0]?.id
    if (!groupId || !groups.some((group) => group.id === groupId)) {
      const ungrouped = createUngroupedGroup()
      nextGroups = [...groups, ungrouped]
      groupId = ungrouped.id
    }

    const dataset = createDataset(`Dataset ${datasets.length + 1}`, groupId)
    const groupDatasets = orderedDatasets.filter((item) => (item.groupId ?? UNGROUPED_ID) === groupId)
    onWorkspaceChange({
      groups: nextGroups,
      datasets: [...datasets, { ...dataset, order: (groupDatasets.at(-1)?.order ?? 0) + 1 }],
      activeDatasetId: dataset.id,
    })
  }

  function nextActiveDatasetId(removedIds: Set<string>) {
    if (!removedIds.has(activeDatasetId)) return activeDatasetId
    const activeIndex = orderedDatasets.findIndex((dataset) => dataset.id === activeDatasetId)
    const remaining = orderedDatasets.filter((dataset) => !removedIds.has(dataset.id))
    return remaining[Math.min(Math.max(activeIndex, 0), remaining.length - 1)]?.id ?? ''
  }

  function deleteDataset(dataset: Dataset) {
    if (!window.confirm(`Delete dataset "${dataset.name || 'Untitled'}"? This action cannot be undone.`)) return
    const removedIds = new Set([dataset.id])
    onWorkspaceChange({
      datasets: datasets.filter((item) => item.id !== dataset.id),
      activeDatasetId: nextActiveDatasetId(removedIds),
    })
  }

  function renameDataset(id: string, name: string) {
    setDatasets(
      datasets.map((dataset) => (dataset.id === id ? touchDataset({ ...dataset, name }) : dataset)),
      id,
    )
  }

  function moveDataset(id: string, groupId: string) {
    const targetGroup = orderedDatasets.filter((dataset) => (dataset.groupId ?? UNGROUPED_ID) === groupId)
    setDatasets(
      datasets.map((dataset) =>
        dataset.id === id
          ? touchDataset({ ...dataset, groupId, order: (targetGroup.at(-1)?.order ?? 0) + 1 })
          : dataset,
      ),
      id,
    )
  }

  function duplicateActive() {
    if (!activeDataset) return
    const copy = duplicateDataset(activeDataset)
    setDatasets([...datasets, { ...copy, order: (activeDataset.order ?? 0) + 0.5 }], copy.id)
  }

  function addGroup() {
    const name = window.prompt('New group name', 'New Group')?.trim()
    if (!name) return
    onWorkspaceChange({ groups: [...groups, { ...createGroup(name), order: (orderedGroups.at(-1)?.order ?? 0) + 1 }] })
  }

  function renameGroup(group: DatasetGroup) {
    const name = window.prompt('Rename group', group.name)?.trim()
    if (!name) return
    onWorkspaceChange({
      groups: groups.map((item) =>
        item.id === group.id ? { ...item, name, updatedAt: Date.now() } : item,
      ),
    })
  }

  function deleteGroup(group: DatasetGroup) {
    const groupDatasets = orderedDatasets.filter(
      (dataset) => (dataset.groupId ?? UNGROUPED_ID) === group.id,
    )
    const remainingGroups = orderedGroups.filter((item) => item.id !== group.id)
    const targetGroup = remainingGroups.find((item) => item.id === UNGROUPED_ID) ?? remainingGroups[0]

    if (groupDatasets.length > 0) {
      const message = targetGroup
        ? `Delete group "${group.name}"? Its ${groupDatasets.length} dataset(s) will move to "${targetGroup.name}".`
        : `Delete group "${group.name}" and its ${groupDatasets.length} dataset(s)? There is no other group to move them to. This action cannot be undone.`
      if (!window.confirm(message)) return
    }

    const removedIds = targetGroup ? new Set<string>() : new Set(groupDatasets.map((dataset) => dataset.id))
    const targetDatasets = targetGroup
      ? orderedDatasets.filter((dataset) => (dataset.groupId ?? UNGROUPED_ID) === targetGroup.id)
      : []
    const firstTargetOrder = (targetDatasets.at(-1)?.order ?? -1) + 1
    const movedById = new Map(
      groupDatasets.map((dataset, index) => [
        dataset.id,
        touchDataset({ ...dataset, groupId: targetGroup?.id, order: firstTargetOrder + index }),
      ]),
    )

    onWorkspaceChange({
      groups: groups.filter((item) => item.id !== group.id),
      datasets: targetGroup
        ? datasets.map((dataset) => movedById.get(dataset.id) ?? dataset)
        : datasets.filter((dataset) => !removedIds.has(dataset.id)),
      collapsedGroupIds: collapsedGroupIds.filter((id) => id !== group.id),
      activeDatasetId: nextActiveDatasetId(removedIds),
    })
  }

  function toggleGroup(groupId: string) {
    onWorkspaceChange({
      collapsedGroupIds: collapsedGroupIds.includes(groupId)
        ? collapsedGroupIds.filter((id) => id !== groupId)
        : [...collapsedGroupIds, groupId],
    })
  }

  function reorderDatasets(draggedId: string, target: { groupId: string; beforeId?: string; afterId?: string }) {
    const dragged = datasets.find((dataset) => dataset.id === draggedId)
    if (!dragged) return

    const targetItems = orderedDatasets
      .filter((dataset) => dataset.id !== draggedId)
      .filter((dataset) => (dataset.groupId ?? UNGROUPED_ID) === target.groupId)

    let insertIndex = targetItems.length
    if (target.beforeId) {
      insertIndex = Math.max(0, targetItems.findIndex((dataset) => dataset.id === target.beforeId))
    } else if (target.afterId) {
      insertIndex = targetItems.findIndex((dataset) => dataset.id === target.afterId) + 1
      if (insertIndex <= 0) insertIndex = targetItems.length
    }

    const nextGroupItems = [
      ...targetItems.slice(0, insertIndex),
      { ...dragged, groupId: target.groupId },
      ...targetItems.slice(insertIndex),
    ].map((dataset, index) => ({
      ...dataset,
      order: index,
      updatedAt: dataset.id === draggedId ? Date.now() : dataset.updatedAt,
    }))

    const nextById = new Map(nextGroupItems.map((dataset) => [dataset.id, dataset]))
    setDatasets(
      datasets.map((dataset) => nextById.get(dataset.id) ?? dataset),
      draggedId,
    )
  }

  function finishDrop(target: { groupId: string; beforeId?: string; afterId?: string }) {
    if (draggedDatasetId) reorderDatasets(draggedDatasetId, target)
    setDraggedDatasetId(null)
    setDropTarget(null)
  }

  function allowGroupDrop(groupId: string) {
    setDropTarget({ groupId })
    if (collapsedGroupIds.includes(groupId)) {
      window.setTimeout(() => {
        onWorkspaceChange({
          collapsedGroupIds: collapsedGroupIds.filter((id) => id !== groupId),
        })
      }, 550)
    }
  }

  async function uploadMaster(file: File) {
    const workbook = await readWorkbook(file)
    const result = upsertMasterWorkbook(datasets, workbook)
    onWorkspaceChange({ datasets: result.datasets })
    showMasterReport(result.report)
    const importedName = result.report.datasetReports.find((item) => item.importedRows > 0)?.datasetName
    const importedDataset = importedName
      ? result.datasets.find((dataset) => dataset.name.trim().toLowerCase() === importedName.trim().toLowerCase())
      : undefined
    if (importedDataset) {
      logImportDiagnostics(importedDataset, result.report.totalRows, result.report.invalidRows)
      onViewChart(importedDataset.id)
    }
  }

  async function uploadDaily(file: File) {
    const workbook = await readWorkbook(file)
    const result = importDailyWorkbook(datasets, workbook)
    if (result.report.addedRows > 0) onWorkspaceChange({ datasets: result.datasets })
    setDailyImportResult({ report: result.report, duplicates: result.duplicates })
    result.report.datasetReports.forEach((item) => {
      if (item.addedRows === 0 || !item.datasetId) return
      const dataset = result.datasets.find((candidate) => candidate.id === item.datasetId)
      if (dataset) logImportDiagnostics(dataset, item.totalRows, item.invalidRows)
    })
  }

  async function uploadDatasetExcel(file: File) {
    if (!activeDataset) return
    const workbook = await readWorkbook(file)
    const rows = readSheetRows(workbook.Sheets[workbook.SheetNames[0]])
    const result = upsertDatasetFromRows(activeDataset, rows, activeDataset.name, workbookDateOptions(workbook))
    if (result.report.importedRows > 0) updateDataset(result.dataset)
    showMasterReport({
      datasetsProcessed: 1,
      totalRows: result.report.totalRows,
      importedRows: result.report.importedRows,
      invalidRows: result.report.invalidRows,
      duplicateDates: result.report.duplicateDates,
      earliestDate: result.report.earliestDate,
      latestDate: result.report.latestDate,
      inserted: result.report.inserted,
      updated: result.report.updated,
      unchanged: result.report.unchanged,
      errors: result.report.invalidRows,
      datasetReports: [result.report],
    })
    logImportDiagnostics(result.dataset, result.report.totalRows, result.report.invalidRows)
    if (result.report.importedRows > 0) onViewChart(result.dataset.id)
  }

  function logImportDiagnostics(dataset: Dataset, totalRows: number, invalidRows: number) {
    if (!import.meta.env.DEV) return
    const model = buildMarketData(dataset)
    console.info([
      `Dataset imported: ${dataset.name}`,
      `Total rows: ${totalRows}`,
      `Valid rows: ${model.validRows}`,
      `Invalid rows: ${invalidRows}`,
      `Date range: ${model.candles[0]?.timestamp ?? '-'} -> ${model.candles.at(-1)?.timestamp ?? '-'}`,
      `OHLC detected: ${model.ohlcDetected}`,
      `Volume detected: ${model.volumeDetected}`,
    ].join('\n'))
  }

  function showMasterReport(report: MasterUpdateReport) {
    const lines = [
      'Master Data Update Completed',
      '',
      `Datasets processed: ${report.datasetsProcessed}`,
      `Imported: ${report.importedRows.toLocaleString()} valid rows / ${report.totalRows.toLocaleString()} total rows`,
      `Skipped: ${report.invalidRows.toLocaleString()} invalid rows`,
      `Duplicate dates: ${report.duplicateDates.toLocaleString()}`,
      `From: ${report.earliestDate ? formatIsoToDdMmYy(report.earliestDate) : '-'}`,
      `To: ${report.latestDate ? formatIsoToDdMmYy(report.latestDate) : '-'}`,
      `New rows: ${report.inserted}`,
      `Updated rows: ${report.updated}`,
      `Unchanged rows: ${report.unchanged}`,
      '',
      ...report.datasetReports.map((item) => {
        const range = item.earliestDate && item.latestDate
          ? `${formatIsoToDdMmYy(item.earliestDate)} to ${formatIsoToDdMmYy(item.latestDate)}`
          : 'no valid date range'
        const errors = item.errors.length ? ` Errors: ${item.errors.slice(0, 5).join(', ')}` : ''
        return `${item.datasetName}: ${item.importedRows}/${item.totalRows} imported, ${item.invalidRows} invalid, ${item.duplicateDates} duplicates, ${range}; +${item.inserted} new, ~${item.updated} updated, ${item.unchanged} unchanged.${errors}`
      }),
    ]
    window.alert(lines.join('\n'))
  }

  return (
    <main className="workspace data-page">
      <aside className="dataset-sidebar">
        <div className="sidebar-title">
          <span>Data Groups</span>
          <button type="button" className="icon-button" title="New group" onClick={addGroup}>
            <FolderPlus size={16} />
          </button>
        </div>
        <div className="bulk-update">
          <section className="update-block daily-update-block">
            <strong>Daily Update</strong>
            <button type="button" onClick={() => downloadDailyMasterExcel(datasets)}>
              <Download size={16} /> Download Daily Excel
            </button>
            <label className="file-button">
              <Upload size={16} /> Upload Daily Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadDaily(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            {dailyImportResult && (
              <div className="daily-import-result" aria-live="polite">
                <div className="daily-import-summary">
                  <b>+{dailyImportResult.report.addedRows.toLocaleString()} added</b>
                  <span>{dailyImportResult.report.duplicateRows.toLocaleString()} duplicate</span>
                  <span>{dailyImportResult.report.invalidRows.toLocaleString()} invalid</span>
                </div>
                {dailyImportResult.report.datasetReports.map((item) => (
                  <div className="daily-dataset-result" key={`${item.sheetName}:${item.datasetId ?? 'unmatched'}`}>
                    <span title={item.sheetName}>{item.datasetName}</span>
                    <small>+{item.addedRows} / {item.totalRows}</small>
                  </div>
                ))}
                {dailyImportResult.report.datasetReports.flatMap((item) => item.errors).slice(0, 5).map((error, index) => (
                  <p className="daily-import-error" key={`${error}:${index}`}>{error}</p>
                ))}
                {dailyImportResult.duplicates.length > 0 && (
                  <>
                    <div className="daily-duplicate-list" role="table" aria-label="Skipped duplicate dates">
                      {dailyImportResult.duplicates.map((duplicate) => (
                        <div className="daily-duplicate-row" role="row" key={duplicate.id} title={duplicate.message}>
                          <span>{duplicate.datasetName}</span>
                          <span className="duplicate-date-cell">{formatIsoToDdMmYy(duplicate.date)}</span>
                          <small>row {duplicate.sourceRowNumber}</small>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="remove-duplicates-button"
                      onClick={() => setDailyImportResult({ ...dailyImportResult, duplicates: [] })}
                    >
                      <Trash2 size={16} /> Remove Duplicates
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
          <section className="update-block master-update-block">
            <strong>Full Master Data</strong>
            <button type="button" onClick={() => downloadMasterExcel(datasets)}>
              <FileSpreadsheet size={16} /> Download Master Excel
            </button>
            <label className="file-button">
              <Upload size={16} /> Upload Master Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadMaster(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </section>
        </div>
        <div
          className="dataset-list grouped"
          onDragOver={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (event.clientY < rect.top + 42) event.currentTarget.scrollTop -= 12
            if (event.clientY > rect.bottom - 42) event.currentTarget.scrollTop += 12
          }}
        >
          {orderedGroups.map((group) => {
            const groupDatasets = orderedDatasets.filter((dataset) => (dataset.groupId ?? UNGROUPED_ID) === group.id)
            const collapsed = collapsedGroupIds.includes(group.id)
            return (
              <section
                className={dropTarget?.groupId === group.id && !dropTarget.beforeId && !dropTarget.afterId ? 'group-section drop-group' : 'group-section'}
                key={group.id}
                onDragOver={(event) => {
                  event.preventDefault()
                  allowGroupDrop(group.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  finishDrop({ groupId: group.id })
                }}
              >
                <div className="group-row">
                  <button type="button" className="group-toggle" onClick={() => toggleGroup(group.id)}>
                    <ChevronRight size={15} className={collapsed ? '' : 'open'} />
                    <span>{group.name}</span>
                    <small>{groupDatasets.length}</small>
                  </button>
                  <button type="button" className="icon-button" title="Add dataset" onClick={() => addDataset(group.id)}>
                    <Plus size={15} />
                  </button>
                  <button type="button" onClick={() => renameGroup(group)}>Rename</button>
                  <button type="button" className="icon-button danger" title="Delete group" onClick={() => deleteGroup(group)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                {!collapsed && (
                  <div className="group-datasets">
                    {groupDatasets.map((dataset) => (
                      <div
                        key={dataset.id}
                        className={[
                          'dataset-drag-row',
                          dataset.id === activeDataset?.id ? 'active' : '',
                          draggedDatasetId === dataset.id ? 'dragging' : '',
                        ].filter(Boolean).join(' ')}
                        onDragOver={(event) => {
                          event.preventDefault()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const before = event.clientY < rect.top + rect.height / 2
                          setDropTarget(before ? { groupId: group.id, beforeId: dataset.id } : { groupId: group.id, afterId: dataset.id })
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          const rect = event.currentTarget.getBoundingClientRect()
                          const before = event.clientY < rect.top + rect.height / 2
                          finishDrop(before ? { groupId: group.id, beforeId: dataset.id } : { groupId: group.id, afterId: dataset.id })
                        }}
                      >
                        {dropTarget?.beforeId === dataset.id && <div className="drop-line" />}
                        <button
                          type="button"
                          className="drag-handle"
                          draggable
                          title="Drag dataset"
                          onDragStart={(event) => {
                            setDraggedDatasetId(dataset.id)
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', dataset.id)
                          }}
                          onDragEnd={() => {
                            setDraggedDatasetId(null)
                            setDropTarget(null)
                          }}
                        >
                          <GripVertical size={15} />
                        </button>
                        <button
                          type="button"
                          className="dataset-item"
                          onClick={() => onWorkspaceChange({ activeDatasetId: dataset.id })}
                        >
                          <span>{dataset.name || 'Untitled'}</span>
                          <small>{dataset.rows.length.toLocaleString()} rows</small>
                        </button>
                        <button
                          type="button"
                          className="icon-button dataset-delete-button"
                          title="Delete dataset"
                          aria-label={`Delete dataset ${dataset.name || 'Untitled'}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteDataset(dataset)
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                        {dropTarget?.afterId === dataset.id && <div className="drop-line after" />}
                      </div>
                    ))}
                    {groupDatasets.length === 0 && (
                      <div className="empty-drop-target">Drop dataset here</div>
                    )}
                  </div>
                )}
              </section>
            )
          })}
          {orderedGroups.length === 0 && (
            <div className="sidebar-empty-state">
              <span>No groups or datasets</span>
              <button type="button" onClick={() => addDataset()}>
                <Plus size={15} /> Add Dataset
              </button>
            </div>
          )}
        </div>
        {activeDataset && (
          <div className="dataset-tools">
            <label>
              Name
              <input
                value={activeDataset.name}
                onChange={(event) => renameDataset(activeDataset.id, event.target.value)}
              />
            </label>
            <label>
              Group
              <select
                value={activeDataset.groupId ?? UNGROUPED_ID}
                onChange={(event) => moveDataset(activeDataset.id, event.target.value)}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={duplicateActive}>
              <Copy size={16} /> Duplicate Dataset
            </button>
            <button type="button" onClick={() => onViewChart(activeDataset.id)}>
              <BarChart3 size={16} /> View Chart
            </button>
            <button type="button" onClick={() => activeDataset && downloadDatasetExcel(activeDataset)}>
              <FileSpreadsheet size={16} /> Download Dataset Excel
            </button>
            <label className="file-button">
              <Upload size={16} /> Upload Dataset File
              <input
                type="file"
                accept=".csv,.tsv,.xlsx,.xls"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void uploadDatasetExcel(file)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          </div>
        )}
      </aside>
      {activeDataset ? (
        <DataGrid dataset={activeDataset} onChange={updateDataset} />
      ) : (
        <section className="data-grid-shell workspace-empty-state">
          <div>
            <strong>No dataset selected</strong>
            <span>Create a dataset to start entering market data.</span>
            <button type="button" onClick={() => addDataset()}>
              <Plus size={16} /> Add Dataset
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
