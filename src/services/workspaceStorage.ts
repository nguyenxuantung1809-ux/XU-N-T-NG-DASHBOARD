import { get, set } from 'idb-keyval'
import type { ChartFilterState, ChartIndicatorConfig, ChartPanelConfig, Dataset, DatasetGroup, WorkspaceState } from '../types/market'
import { createDataset, createUngroupedGroup, UNGROUPED_ID } from '../utils/dataset'

const STORAGE_KEY = 'market-data-visualizer.workspace.v1'

function createChartPanels(datasets: Dataset[]): ChartPanelConfig[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `chart-panel-${index + 1}`,
    datasetId: datasets[index % Math.max(datasets.length, 1)]?.id ?? '',
    chartType: 'candlestick',
    indicators: [],
  }))
}

function createChartFilter(datasets: Dataset[]): ChartFilterState {
  return {
    layout: 1,
    panels: createChartPanels(datasets),
    replayEnabled: false,
    replayDate: null,
  }
}

function numberInRange(value: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function textColor(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function paneSettings(candidate: Record<string, unknown>, height = 1.1, zoom = 1) {
  return {
    height: numberInRange(candidate.height, height, 0.55, 3),
    zoom: numberInRange(candidate.zoom, zoom, 0.5, 5),
  }
}

function sanitizeIndicators(value: unknown): ChartIndicatorConfig[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ChartIndicatorConfig[] => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id : `indicator-${Date.now()}`
    if (candidate.type === 'SMA') {
      return [{
        id,
        type: 'SMA',
        period: numberInRange(candidate.period, 20, 2, 500),
        color: textColor(candidate.color, '#38bdf8'),
      }]
    }
    if (candidate.type === 'EMA') {
      return [{
        id,
        type: 'EMA',
        period: numberInRange(candidate.period, 21, 2, 500),
        color: textColor(candidate.color, '#f59e0b'),
      }]
    }
    if (candidate.type === 'WMA') {
      return [{
        id,
        type: 'WMA',
        period: numberInRange(candidate.period, 20, 2, 500),
        color: textColor(candidate.color, '#22c55e'),
      }]
    }
    if (candidate.type === 'BOLLINGER') {
      return [{
        id,
        type: 'BOLLINGER',
        period: numberInRange(candidate.period, 20, 2, 500),
        multiplier: numberInRange(candidate.multiplier, 2, 0.1, 10),
        color: textColor(candidate.color, '#60a5fa'),
      }]
    }
    if (candidate.type === 'VWAP') {
      return [{ id, type: 'VWAP', color: textColor(candidate.color, '#ec4899') }]
    }
    if (candidate.type === 'SUPERTREND') {
      return [{
        id,
        type: 'SUPERTREND',
        period: numberInRange(candidate.period, 10, 2, 200),
        multiplier: numberInRange(candidate.multiplier, 3, 0.1, 20),
      }]
    }
    if (candidate.type === 'RSI') {
      return [{
        id,
        type: 'RSI',
        period: numberInRange(candidate.period, 14, 2, 200),
        ...paneSettings(candidate),
      }]
    }
    if (candidate.type === 'MACD') {
      return [{
        id,
        type: 'MACD',
        fast: numberInRange(candidate.fast, 12, 2, 200),
        slow: numberInRange(candidate.slow, 26, 3, 300),
        signal: numberInRange(candidate.signal, 9, 2, 200),
        ...paneSettings(candidate),
      }]
    }
    if (candidate.type === 'STOCHASTIC') {
      return [{
        id,
        type: 'STOCHASTIC',
        kPeriod: numberInRange(candidate.kPeriod, 14, 2, 200),
        dPeriod: numberInRange(candidate.dPeriod, 3, 1, 100),
        ...paneSettings(candidate),
      }]
    }
    if (candidate.type === 'ATR') {
      return [{
        id,
        type: 'ATR',
        period: numberInRange(candidate.period, 14, 2, 200),
        ...paneSettings(candidate, 1),
      }]
    }
    if (candidate.type === 'ADX') {
      return [{
        id,
        type: 'ADX',
        period: numberInRange(candidate.period, 14, 2, 200),
        ...paneSettings(candidate),
      }]
    }
    if (candidate.type === 'OBV') {
      return [{
        id,
        type: 'OBV',
        ...paneSettings(candidate, 1),
      }]
    }
    if (candidate.type === 'ICHIMOKU') {
      return [{
        id,
        type: 'ICHIMOKU',
        tenkan: numberInRange(candidate.tenkan, 9, 2, 200),
        kijun: numberInRange(candidate.kijun, 26, 2, 200),
        senkouB: numberInRange(candidate.senkouB, 52, 2, 300),
      }]
    }
    return []
  })
}

export function createInitialWorkspace(): WorkspaceState {
  const dataset = createDataset('XAU')
  return {
    datasets: [dataset],
    groups: [createUngroupedGroup()],
    collapsedGroupIds: [],
    chartFilter: createChartFilter([dataset]),
    activeDatasetId: dataset.id,
    theme: 'dark',
  }
}

export function migrateWorkspace(saved: Partial<WorkspaceState> | null | undefined): WorkspaceState {
  if (!saved || !Array.isArray(saved.datasets)) return createInitialWorkspace()

  const groupsWereSaved = Array.isArray(saved.groups)
  let groups: DatasetGroup[] = (groupsWereSaved ? [...saved.groups!] : [createUngroupedGroup()])
    .map((group, index) => ({ ...group, order: group.order ?? index }))

  if (saved.datasets.length > 0 && groups.length === 0) {
    groups = [createUngroupedGroup()]
  }

  let validGroupIds = new Set(groups.map((group) => group.id))
  const hasOrphanedDataset = saved.datasets.some(
    (dataset) => !dataset.groupId || !validGroupIds.has(dataset.groupId),
  )
  if (hasOrphanedDataset && !validGroupIds.has(UNGROUPED_ID)) {
    groups = [createUngroupedGroup(), ...groups]
    validGroupIds = new Set(groups.map((group) => group.id))
  }

  const datasets: Dataset[] = saved.datasets.map((dataset, index) => ({
    ...dataset,
    groupId: dataset.groupId && validGroupIds.has(dataset.groupId) ? dataset.groupId : UNGROUPED_ID,
    order: dataset.order ?? index,
  }))

  const activeDatasetId = datasets.some((dataset) => dataset.id === saved.activeDatasetId)
    ? saved.activeDatasetId!
    : datasets[0]?.id ?? ''
  const datasetIds = new Set(datasets.map((dataset) => dataset.id))
  const rawChart = (saved.chartFilter ?? {}) as unknown as Record<string, unknown>
  const rawPanels = Array.isArray(rawChart.panels) ? rawChart.panels : []
  const legacySelected = Array.isArray(rawChart.selectedDatasetIds)
    ? rawChart.selectedDatasetIds.filter((id): id is string => typeof id === 'string' && datasetIds.has(id))
    : []
  const panels = createChartPanels(datasets).map((fallback, index): ChartPanelConfig => {
    const rawPanel = rawPanels[index] && typeof rawPanels[index] === 'object'
      ? rawPanels[index] as Record<string, unknown>
      : null
    const requestedDatasetId = typeof rawPanel?.datasetId === 'string'
      ? rawPanel.datasetId
      : legacySelected[index]
    return {
      id: typeof rawPanel?.id === 'string' ? rawPanel.id : fallback.id,
      datasetId: requestedDatasetId && datasetIds.has(requestedDatasetId)
        ? requestedDatasetId
        : fallback.datasetId,
      chartType: rawPanel?.chartType === 'line' ? 'line' : 'candlestick',
      indicators: sanitizeIndicators(rawPanel?.indicators),
    }
  })
  if (rawPanels.length === 0 && Array.isArray(rawChart.indicators)) {
    panels[0].indicators = sanitizeIndicators(rawChart.indicators)
  }
  const requestedLayout = Number(rawChart.layout)
  const layout = rawChart.layout === '2v'
    ? '2v'
    : requestedLayout === 2 || requestedLayout === 4
      ? requestedLayout
      : 1

  return {
    datasets,
    groups,
    collapsedGroupIds: (saved.collapsedGroupIds ?? []).filter((id) => validGroupIds.has(id)),
    chartFilter: {
      layout,
      panels,
      replayEnabled: rawChart.replayEnabled === true,
      replayDate: typeof rawChart.replayDate === 'string' ? rawChart.replayDate : null,
    },
    activeDatasetId,
    theme: saved.theme ?? 'dark',
  }
}

export async function loadWorkspace(): Promise<WorkspaceState> {
  const saved = await get<Partial<WorkspaceState>>(STORAGE_KEY)
  return migrateWorkspace(saved)
}

export async function saveWorkspace(workspace: WorkspaceState) {
  await set(STORAGE_KEY, workspace)
}
