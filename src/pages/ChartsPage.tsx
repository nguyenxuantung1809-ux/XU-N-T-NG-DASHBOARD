import {
  Activity,
  ChevronDown,
  Columns2,
  Crosshair,
  Grid2X2,
  Link2,
  Rows2,
  Maximize2,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarketChart, type MarketChartHandle } from '../components/MarketChart'
import type {
  ChartFilterState,
  ChartIndicatorConfig,
  ChartLayoutMode,
  ChartPanelConfig,
  Dataset,
  ThemeMode,
  VisibleTimeRange,
} from '../types/market'
import { formatIsoToDdMmYyyy } from '../utils/dates'
import { createId } from '../utils/ids'
import { buildMarketData, stepReplayTimestamp } from '../utils/marketChartData'

interface ChartsPageProps {
  datasets: Dataset[]
  theme: ThemeMode
  chartFilter: ChartFilterState
  onChartFilterChange: (chartFilter: ChartFilterState) => void
}

export function ChartsPage({ datasets, theme, chartFilter, onChartFilterChange }: ChartsPageProps) {
  const [activePanelId, setActivePanelId] = useState(chartFilter.panels[0]?.id ?? '')
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false)
  const [replaySelectionMode, setReplaySelectionMode] = useState(false)
  const [syncTimeMasterId, setSyncTimeMasterId] = useState<string | null>(null)
  const [crosshair, setCrosshair] = useState<{ sourceId: string; timestamp: string } | null>(null)
  const chartRefs = useRef<Record<string, MarketChartHandle | null>>({})
  const syncTimeMasterIdRef = useRef<string | null>(null)
  const visiblePanelIdsRef = useRef<string[]>([])
  const orderedDatasets = useMemo(
    () => [...datasets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [datasets],
  )
  const modelsById = useMemo(
    () => new Map(orderedDatasets.map((dataset) => [dataset.id, buildMarketData(dataset)])),
    [orderedDatasets],
  )
  const visiblePanelCount = chartFilter.layout === '2v' ? 2 : chartFilter.layout
  const visiblePanels = chartFilter.panels.slice(0, visiblePanelCount)
  const visiblePanelIds = visiblePanels.map((panel) => panel.id)
  const visiblePanelKey = visiblePanelIds.join('|')
  visiblePanelIdsRef.current = visiblePanelIds
  const activePanel = chartFilter.panels.find((panel) => panel.id === activePanelId) ?? visiblePanels[0]
  const activeDataset = orderedDatasets.find((dataset) => dataset.id === activePanel?.datasetId)
  const activeTimestamps = useMemo(() => {
    const candles = activeDataset ? modelsById.get(activeDataset.id)?.candles ?? [] : []
    return candles.map((candle) => candle.timestamp)
  }, [activeDataset, modelsById])
  const filteredSymbols = orderedDatasets.filter((dataset) =>
    dataset.name.toLowerCase().includes(symbolSearch.trim().toLowerCase()),
  )

  useEffect(() => {
    if (!visiblePanels.some((panel) => panel.id === activePanelId)) {
      setActivePanelId(visiblePanels[0]?.id ?? '')
    }
  }, [activePanelId, visiblePanels])

  useEffect(() => {
    if (
      syncTimeMasterId &&
      (visiblePanelCount === 1 || !visiblePanelIdsRef.current.includes(syncTimeMasterId))
    ) {
      syncTimeMasterIdRef.current = null
      setSyncTimeMasterId(null)
    }
  }, [syncTimeMasterId, visiblePanelCount, visiblePanelKey])

  function updateFilter(patch: Partial<ChartFilterState>) {
    onChartFilterChange({ ...chartFilter, ...patch })
  }

  function updatePanel(panelId: string, updater: (panel: ChartPanelConfig) => ChartPanelConfig) {
    updateFilter({
      panels: chartFilter.panels.map((panel) => panel.id === panelId ? updater(panel) : panel),
    })
  }

  function selectSymbol(panelId: string, datasetId: string) {
    updatePanel(panelId, (panel) => ({ ...panel, datasetId }))
    setActivePanelId(panelId)
    setSymbolMenuOpen(false)
    setSymbolSearch('')
  }

  function setLayout(layout: ChartLayoutMode) {
    updateFilter({ layout })
    const firstPanel = chartFilter.panels[0]
    const panelCount = layout === '2v' ? 2 : layout
    if (!chartFilter.panels.slice(0, panelCount).some((panel) => panel.id === activePanelId) && firstPanel) {
      setActivePanelId(firstPanel.id)
    }
  }

  function addIndicator(type: ChartIndicatorConfig['type']) {
    if (!activePanel || activePanel.indicators.some((indicator) => indicator.type === type)) return
    const indicator: ChartIndicatorConfig = type === 'RSI'
      ? { id: createId('indicator'), type: 'RSI', period: 14 }
      : type === 'MACD'
        ? { id: createId('indicator'), type: 'MACD', fast: 12, slow: 26, signal: 9 }
        : { id: createId('indicator'), type: 'ICHIMOKU', tenkan: 9, kijun: 26, senkouB: 52 }
    updatePanel(activePanel.id, (panel) => ({ ...panel, indicators: [...panel.indicators, indicator] }))
  }

  function removeIndicator(indicatorId: string) {
    if (!activePanel) return
    updatePanel(activePanel.id, (panel) => ({
      ...panel,
      indicators: panel.indicators.filter((indicator) => indicator.id !== indicatorId),
    }))
  }

  function patchIndicator(indicatorId: string, patch: Record<string, number>) {
    if (!activePanel) return
    updatePanel(activePanel.id, (panel) => ({
      ...panel,
      indicators: panel.indicators.map((indicator) =>
        indicator.id === indicatorId ? { ...indicator, ...patch } as ChartIndicatorConfig : indicator,
      ),
    }))
  }

  function startReplaySelection() {
    setReplaySelectionMode(true)
    setSymbolMenuOpen(false)
    setIndicatorMenuOpen(false)
  }

  const stepReplay = useCallback((direction: -1 | 1) => {
    if (!chartFilter.replayEnabled || activeTimestamps.length === 0) return
    const currentDate = chartFilter.replayDate ?? activeTimestamps.at(-1)!
    onChartFilterChange({
      ...chartFilter,
      replayDate: stepReplayTimestamp(activeTimestamps, currentDate, direction),
    })
  }, [activeTimestamps, chartFilter, onChartFilterChange])

  const handleReplayPointSelect = useCallback((panelId: string, timestamp: string) => {
    setActivePanelId(panelId)
    setReplaySelectionMode(false)
    onChartFilterChange({ ...chartFilter, replayEnabled: true, replayDate: timestamp })
  }, [chartFilter, onChartFilterChange])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (replaySelectionMode && event.key === 'Escape') {
        event.preventDefault()
        setReplaySelectionMode(false)
        return
      }
      if (!chartFilter.replayEnabled || replaySelectionMode) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea, button')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        stepReplay(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chartFilter.replayEnabled, replaySelectionMode, stepReplay])

  const handleCrosshairChange = useCallback((sourceId: string, timestamp: string | null) => {
    setCrosshair((current) => {
      if (timestamp) {
        return current?.sourceId === sourceId && current.timestamp === timestamp
          ? current
          : { sourceId, timestamp }
      }
      return current?.sourceId === sourceId ? null : current
    })
  }, [])

  const handleVisibleTimeRangeChange = useCallback((sourceId: string, range: VisibleTimeRange) => {
    if (syncTimeMasterIdRef.current !== sourceId) return
    visiblePanelIdsRef.current.forEach((panelId) => {
      if (panelId !== sourceId) chartRefs.current[panelId]?.setVisibleTimeRange(range)
    })
  }, [])

  function toggleSyncTime(panelId: string) {
    if (syncTimeMasterIdRef.current === panelId) {
      syncTimeMasterIdRef.current = null
      setSyncTimeMasterId(null)
      return
    }
    const range = chartRefs.current[panelId]?.getVisibleTimeRange() ?? null
    syncTimeMasterIdRef.current = panelId
    setSyncTimeMasterId(panelId)
    if (!range) return
    visiblePanelIdsRef.current.forEach((targetId) => {
      if (targetId !== panelId) chartRefs.current[targetId]?.setVisibleTimeRange(range)
    })
  }

  if (orderedDatasets.length === 0) {
    return (
      <main className="chart-terminal empty-terminal">
        <strong>No market datasets</strong>
        <span>Upload an OHLC CSV or Excel file from Data Input.</span>
      </main>
    )
  }

  return (
    <main className="chart-terminal">
      <div className="terminal-toolbar">
        <div className="toolbar-menu-anchor">
          <button
            type="button"
            className="symbol-toolbar-button"
            onClick={() => setSymbolMenuOpen((open) => !open)}
          >
            <strong>{activeDataset?.name ?? 'Symbol'}</strong>
            <ChevronDown size={14} />
          </button>
          {symbolMenuOpen && activePanel && (
            <div className="terminal-popover symbol-menu">
              <div className="symbol-search">
                <Search size={15} />
                <input
                  autoFocus
                  value={symbolSearch}
                  placeholder="Search symbol"
                  onChange={(event) => setSymbolSearch(event.target.value)}
                />
              </div>
              <div className="symbol-results">
                {filteredSymbols.map((dataset) => {
                  const model = modelsById.get(dataset.id)
                  return (
                    <button
                      type="button"
                      className={dataset.id === activePanel.datasetId ? 'active' : ''}
                      key={dataset.id}
                      onClick={() => selectSymbol(activePanel.id, dataset.id)}
                    >
                      <span>{dataset.name}</span>
                      <small>{model?.validRows.toLocaleString() ?? 0} candles</small>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="toolbar-menu-anchor">
          <button
            type="button"
            className={indicatorMenuOpen ? 'active' : ''}
            onClick={() => setIndicatorMenuOpen((open) => !open)}
          >
            <Activity size={16} /> Indicators
          </button>
          {indicatorMenuOpen && activePanel && (
            <div className="terminal-popover indicator-menu">
              <div className="popover-title">
                <strong>Indicators</strong>
                <span>{activeDataset?.name}</span>
              </div>
              {(['RSI', 'MACD', 'ICHIMOKU'] as const).map((type) => {
                const indicator = activePanel.indicators.find((item) => item.type === type)
                return (
                  <div className="indicator-setting" key={type}>
                    <div>
                      <strong>{type === 'ICHIMOKU' ? 'Ichimoku Cloud' : type}</strong>
                      {!indicator && <button type="button" onClick={() => addIndicator(type)}>Add</button>}
                      {indicator && (
                        <button type="button" className="icon-button" title="Remove indicator" onClick={() => removeIndicator(indicator.id)}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {indicator?.type === 'RSI' && (
                      <label>Period <input type="number" min={2} value={indicator.period} onChange={(event) => patchIndicator(indicator.id, { period: Math.max(2, Number(event.target.value)) })} /></label>
                    )}
                    {indicator?.type === 'MACD' && (
                      <div className="indicator-inputs">
                        <label>Fast <input type="number" min={2} value={indicator.fast} onChange={(event) => patchIndicator(indicator.id, { fast: Math.max(2, Number(event.target.value)) })} /></label>
                        <label>Slow <input type="number" min={3} value={indicator.slow} onChange={(event) => patchIndicator(indicator.id, { slow: Math.max(3, Number(event.target.value)) })} /></label>
                        <label>Signal <input type="number" min={2} value={indicator.signal} onChange={(event) => patchIndicator(indicator.id, { signal: Math.max(2, Number(event.target.value)) })} /></label>
                      </div>
                    )}
                    {indicator?.type === 'ICHIMOKU' && (
                      <div className="indicator-inputs">
                        <label>Tenkan <input type="number" min={2} value={indicator.tenkan} onChange={(event) => patchIndicator(indicator.id, { tenkan: Math.max(2, Number(event.target.value)) })} /></label>
                        <label>Kijun <input type="number" min={2} value={indicator.kijun} onChange={(event) => patchIndicator(indicator.id, { kijun: Math.max(2, Number(event.target.value)) })} /></label>
                        <label>Span B <input type="number" min={2} value={indicator.senkouB} onChange={(event) => patchIndicator(indicator.id, { senkouB: Math.max(2, Number(event.target.value)) })} /></label>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {replaySelectionMode ? (
          <div className="replay-picker-prompt">
            <Crosshair size={15} />
            <span>Select replay starting point</span>
            <button type="button" className="replay-exit" onClick={() => setReplaySelectionMode(false)}>Cancel</button>
          </div>
        ) : !chartFilter.replayEnabled ? (
          <button type="button" onClick={startReplaySelection}><Play size={15} /> Replay</button>
        ) : (
          <div className="replay-controls">
            <span>REPLAY</span>
            <button type="button" className="icon-button" title="Pick replay point on chart" onClick={startReplaySelection}><Crosshair size={15} /></button>
            <button type="button" className="icon-button" title="Previous candle" onClick={() => stepReplay(-1)}><SkipBack size={15} /></button>
            <input
              type="date"
              min={activeTimestamps[0]?.slice(0, 10)}
              max={activeTimestamps.at(-1)?.slice(0, 10)}
              value={chartFilter.replayDate?.slice(0, 10) ?? ''}
              onChange={(event) => updateFilter({ replayDate: event.target.value || null })}
            />
            <button type="button" className="icon-button" title="Next candle" onClick={() => stepReplay(1)}><SkipForward size={15} /></button>
            <button type="button" className="replay-exit" onClick={() => updateFilter({ replayEnabled: false })}>Exit</button>
          </div>
        )}

        <div className="layout-controls" aria-label="Chart layout">
          <button type="button" className={chartFilter.layout === 1 ? 'active' : ''} title="1 chart" onClick={() => setLayout(1)}><Square size={15} /><span>1</span></button>
          <button type="button" className={chartFilter.layout === 2 ? 'active' : ''} title="2 charts horizontal" onClick={() => setLayout(2)}><Columns2 size={15} /><span>2H</span></button>
          <button type="button" className={chartFilter.layout === '2v' ? 'active' : ''} title="2 charts vertical" onClick={() => setLayout('2v')}><Rows2 size={15} /><span>2V</span></button>
          <button type="button" className={chartFilter.layout === 4 ? 'active' : ''} title="4 charts" onClick={() => setLayout(4)}><Grid2X2 size={15} /><span>4</span></button>
        </div>

        {chartFilter.replayEnabled && !replaySelectionMode && chartFilter.replayDate && (
          <div className="replay-status">REPLAY - {formatIsoToDdMmYyyy(chartFilter.replayDate)}</div>
        )}
      </div>

      <div className={`market-chart-grid layout-${chartFilter.layout}`}>
        {visiblePanels.map((panel) => {
          const dataset = orderedDatasets.find((item) => item.id === panel.datasetId)
          const model = dataset ? modelsById.get(dataset.id) : null
          return (
            <section
              className={`market-chart-panel${panel.id === activePanel?.id ? ' active' : ''}`}
              key={panel.id}
              onMouseDown={() => setActivePanelId(panel.id)}
            >
              <div className="market-panel-bar">
                <select
                  className="panel-symbol-select"
                  value={panel.datasetId}
                  aria-label={`Symbol for chart ${panel.id}`}
                  onChange={(event) => selectSymbol(panel.id, event.target.value)}
                >
                  {orderedDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <span className="timeframe-badge">1D</span>
                <div className="chart-type-toggle" aria-label={`Chart type for ${dataset?.name ?? panel.id}`}>
                  <button
                    type="button"
                    className={panel.chartType === 'candlestick' ? 'active' : ''}
                    onClick={() => updatePanel(panel.id, (current) => ({ ...current, chartType: 'candlestick' }))}
                  >Candles</button>
                  <button
                    type="button"
                    className={panel.chartType === 'line' ? 'active' : ''}
                    onClick={() => updatePanel(panel.id, (current) => ({ ...current, chartType: 'line' }))}
                  >Line</button>
                </div>
                {visiblePanelCount > 1 && (
                  <button
                    type="button"
                    className={`sync-time-toggle${syncTimeMasterId === panel.id ? ' active' : ''}`}
                    title={syncTimeMasterId === panel.id ? 'Disable time synchronization' : 'Sync time with other charts'}
                    aria-pressed={syncTimeMasterId === panel.id}
                    onClick={() => toggleSyncTime(panel.id)}
                  >
                    <Link2 size={13} /> Sync time
                  </button>
                )}
                <small>{model?.validRows.toLocaleString() ?? 0} candles</small>
                <div className="panel-indicators">
                  {panel.indicators.map((indicator) => <span key={indicator.id}>{indicator.type}</span>)}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  title="Fit content"
                  onClick={() => chartRefs.current[panel.id]?.fitContent()}
                >
                  <Maximize2 size={14} />
                </button>
              </div>
              <MarketChart
                ref={(chart) => { chartRefs.current[panel.id] = chart }}
                dataset={dataset}
                config={panel}
                theme={theme}
                replayEnabled={chartFilter.replayEnabled && !replaySelectionMode}
                replayDate={chartFilter.replayDate}
                crosshairDate={crosshair?.timestamp ?? null}
                crosshairSourceId={crosshair?.sourceId ?? null}
                replaySelectionMode={replaySelectionMode}
                onCrosshairChange={handleCrosshairChange}
                onReplayPointSelect={handleReplayPointSelect}
                onVisibleTimeRangeChange={handleVisibleTimeRangeChange}
              />
            </section>
          )
        })}
      </div>
    </main>
  )
}
