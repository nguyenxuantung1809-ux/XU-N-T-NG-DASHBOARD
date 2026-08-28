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

const INDICATOR_CHOICES: Array<{ type: ChartIndicatorConfig['type']; label: string }> = [
  { type: 'SMA', label: 'Moving Average' },
  { type: 'EMA', label: 'Exponential MA' },
  { type: 'WMA', label: 'Weighted MA' },
  { type: 'BOLLINGER', label: 'Bollinger Bands' },
  { type: 'VWAP', label: 'VWAP' },
  { type: 'SUPERTREND', label: 'Supertrend' },
  { type: 'RSI', label: 'RSI' },
  { type: 'MACD', label: 'MACD' },
  { type: 'STOCHASTIC', label: 'Stochastic' },
  { type: 'ATR', label: 'ATR' },
  { type: 'ADX', label: 'ADX / DMI' },
  { type: 'OBV', label: 'OBV' },
  { type: 'ICHIMOKU', label: 'Ichimoku Cloud' },
]

type PaneIndicatorConfig = Extract<ChartIndicatorConfig, { height: number; zoom: number }>

const PANE_INDICATOR_TYPES = new Set<ChartIndicatorConfig['type']>(['RSI', 'MACD', 'STOCHASTIC', 'ATR', 'ADX', 'OBV'])

function createIndicator(type: ChartIndicatorConfig['type']): ChartIndicatorConfig {
  switch (type) {
    case 'SMA':
      return { id: createId('indicator'), type, period: 20, color: '#38bdf8' }
    case 'EMA':
      return { id: createId('indicator'), type, period: 21, color: '#f59e0b' }
    case 'WMA':
      return { id: createId('indicator'), type, period: 20, color: '#22c55e' }
    case 'BOLLINGER':
      return { id: createId('indicator'), type, period: 20, multiplier: 2, color: '#60a5fa' }
    case 'VWAP':
      return { id: createId('indicator'), type, color: '#ec4899' }
    case 'SUPERTREND':
      return { id: createId('indicator'), type, period: 10, multiplier: 3 }
    case 'RSI':
      return { id: createId('indicator'), type, period: 14, height: 1.1, zoom: 1 }
    case 'MACD':
      return { id: createId('indicator'), type, fast: 12, slow: 26, signal: 9, height: 1.1, zoom: 1 }
    case 'STOCHASTIC':
      return { id: createId('indicator'), type, kPeriod: 14, dPeriod: 3, height: 1.1, zoom: 1 }
    case 'ATR':
      return { id: createId('indicator'), type, period: 14, height: 1, zoom: 1 }
    case 'ADX':
      return { id: createId('indicator'), type, period: 14, height: 1.1, zoom: 1 }
    case 'OBV':
      return { id: createId('indicator'), type, height: 1, zoom: 1 }
    case 'ICHIMOKU':
      return { id: createId('indicator'), type, tenkan: 9, kijun: 26, senkouB: 52 }
  }
}

function isPaneIndicator(indicator: ChartIndicatorConfig): indicator is PaneIndicatorConfig {
  return PANE_INDICATOR_TYPES.has(indicator.type)
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function compactIndicatorLabel(type: ChartIndicatorConfig['type']) {
  if (type === 'BOLLINGER') return 'BB'
  if (type === 'STOCHASTIC') return 'STOCH'
  if (type === 'SUPERTREND') return 'ST'
  if (type === 'ICHIMOKU') return 'ICH'
  return type
}

export function ChartsPage({ datasets, theme, chartFilter, onChartFilterChange }: ChartsPageProps) {
  const [activePanelId, setActivePanelId] = useState(chartFilter.panels[0]?.id ?? '')
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false)
  const [symbolSearch, setSymbolSearch] = useState('')
  const [indicatorMenuOpen, setIndicatorMenuOpen] = useState(false)
  const [replaySelectionMode, setReplaySelectionMode] = useState(false)
  const [syncTimeMasterId, setSyncTimeMasterId] = useState<string | null>(null)
  const [crosshair, setCrosshair] = useState<{ sourceId: string; timestamp: string } | null>(null)
  const [hiddenIndicatorPanelIds, setHiddenIndicatorPanelIds] = useState<Set<string>>(() => new Set())
  const [fullscreenPanelId, setFullscreenPanelId] = useState<string | null>(null)
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
    const indicator = createIndicator(type)
    updatePanel(activePanel.id, (panel) => ({ ...panel, indicators: [...panel.indicators, indicator] }))
  }

  function removeIndicator(indicatorId: string) {
    if (!activePanel) return
    updatePanel(activePanel.id, (panel) => ({
      ...panel,
      indicators: panel.indicators.filter((indicator) => indicator.id !== indicatorId),
    }))
  }

  function patchIndicator(indicatorId: string, patch: Record<string, number | string>) {
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

  function setPanelIndicatorsHidden(panelId: string, hidden: boolean) {
    setHiddenIndicatorPanelIds((current) => {
      const next = new Set(current)
      if (hidden) next.add(panelId)
      else next.delete(panelId)
      return next
    })
  }

  function renderNumberControl(
    indicatorId: string,
    label: string,
    key: string,
    value: number,
    min: number,
    max: number,
    step = 1,
  ) {
    return (
      <label>
        {label}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const rawValue = Number(event.target.value)
            const numericValue = Number.isFinite(rawValue) ? rawValue : value
            const nextValue = step === 1 ? Math.round(numericValue) : numericValue
            patchIndicator(indicatorId, { [key]: clampNumber(nextValue, min, max) })
          }}
        />
      </label>
    )
  }

  function renderColorControl(indicatorId: string, value: string) {
    return (
      <label>
        Color
        <input type="color" value={value} onChange={(event) => patchIndicator(indicatorId, { color: event.target.value })} />
      </label>
    )
  }

  function renderPaneControls(indicator: ChartIndicatorConfig) {
    if (!isPaneIndicator(indicator)) return null
    return (
      <div className="indicator-pane-controls">
        <label>
          Height
          <input
            type="range"
            min={0.55}
            max={3}
            step={0.05}
            value={indicator.height}
            onChange={(event) => patchIndicator(indicator.id, { height: Number(event.target.value) })}
          />
          <output>{indicator.height.toFixed(2)}x</output>
        </label>
        <label>
          Zoom
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.05}
            value={indicator.zoom}
            onChange={(event) => patchIndicator(indicator.id, { zoom: Number(event.target.value) })}
          />
          <output>{indicator.zoom.toFixed(2)}x</output>
        </label>
      </div>
    )
  }

  function renderIndicatorControls(indicator: ChartIndicatorConfig) {
    if (indicator.type === 'SMA' || indicator.type === 'EMA' || indicator.type === 'WMA') {
      return (
        <div className="indicator-inputs">
          {renderNumberControl(indicator.id, 'Period', 'period', indicator.period, 2, 500)}
          {renderColorControl(indicator.id, indicator.color)}
        </div>
      )
    }
    if (indicator.type === 'BOLLINGER') {
      return (
        <div className="indicator-inputs">
          {renderNumberControl(indicator.id, 'Period', 'period', indicator.period, 2, 500)}
          {renderNumberControl(indicator.id, 'Dev', 'multiplier', indicator.multiplier, 0.1, 10, 0.1)}
          {renderColorControl(indicator.id, indicator.color)}
        </div>
      )
    }
    if (indicator.type === 'VWAP') {
      return <div className="indicator-inputs">{renderColorControl(indicator.id, indicator.color)}</div>
    }
    if (indicator.type === 'SUPERTREND') {
      return (
        <div className="indicator-inputs">
          {renderNumberControl(indicator.id, 'ATR', 'period', indicator.period, 2, 200)}
          {renderNumberControl(indicator.id, 'Factor', 'multiplier', indicator.multiplier, 0.1, 20, 0.1)}
        </div>
      )
    }
    if (indicator.type === 'RSI') {
      return (
        <>
          <div className="indicator-inputs">
            {renderNumberControl(indicator.id, 'Period', 'period', indicator.period, 2, 200)}
          </div>
          {renderPaneControls(indicator)}
        </>
      )
    }
    if (indicator.type === 'MACD') {
      return (
        <>
          <div className="indicator-inputs">
            {renderNumberControl(indicator.id, 'Fast', 'fast', indicator.fast, 2, 200)}
            {renderNumberControl(indicator.id, 'Slow', 'slow', indicator.slow, 3, 300)}
            {renderNumberControl(indicator.id, 'Signal', 'signal', indicator.signal, 2, 200)}
          </div>
          {renderPaneControls(indicator)}
        </>
      )
    }
    if (indicator.type === 'STOCHASTIC') {
      return (
        <>
          <div className="indicator-inputs">
            {renderNumberControl(indicator.id, '%K', 'kPeriod', indicator.kPeriod, 2, 200)}
            {renderNumberControl(indicator.id, '%D', 'dPeriod', indicator.dPeriod, 1, 100)}
          </div>
          {renderPaneControls(indicator)}
        </>
      )
    }
    if (indicator.type === 'ATR' || indicator.type === 'ADX') {
      return (
        <>
          <div className="indicator-inputs">
            {renderNumberControl(indicator.id, 'Period', 'period', indicator.period, 2, 200)}
          </div>
          {renderPaneControls(indicator)}
        </>
      )
    }
    if (indicator.type === 'OBV') {
      return renderPaneControls(indicator)
    }
    return (
      <div className="indicator-inputs">
        {renderNumberControl(indicator.id, 'Tenkan', 'tenkan', indicator.tenkan, 2, 200)}
        {renderNumberControl(indicator.id, 'Kijun', 'kijun', indicator.kijun, 2, 200)}
        {renderNumberControl(indicator.id, 'Span B', 'senkouB', indicator.senkouB, 2, 300)}
      </div>
    )
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
              {INDICATOR_CHOICES.map(({ type, label }) => {
                const indicator = activePanel.indicators.find((item) => item.type === type)
                return (
                  <div className="indicator-setting" key={type}>
                    <div>
                      <strong>{label}</strong>
                      {!indicator && <button type="button" onClick={() => addIndicator(type)}>Add</button>}
                      {indicator && (
                        <button type="button" className="icon-button" title="Remove indicator" onClick={() => removeIndicator(indicator.id)}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                    {indicator && renderIndicatorControls(indicator)}
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
              className={`market-chart-panel${panel.id === activePanel?.id ? ' active' : ''}${fullscreenPanelId === panel.id ? ' fullscreen' : ''}`}
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
                  {panel.indicators.map((indicator) => <span key={indicator.id}>{compactIndicatorLabel(indicator.type)}</span>)}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  title="Fit content"
                  onClick={() => chartRefs.current[panel.id]?.fitContent()}
                >
                  <Maximize2 size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={fullscreenPanelId === panel.id ? 'Exit full screen' : 'Full screen chart'}
                  onClick={() => setFullscreenPanelId((current) => current === panel.id ? null : panel.id)}
                >
                  {fullscreenPanelId === panel.id ? <X size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
              <MarketChart
                ref={(chart) => { chartRefs.current[panel.id] = chart }}
                dataset={dataset}
                config={panel}
                layoutKey={String(chartFilter.layout)}
                theme={theme}
                replayEnabled={chartFilter.replayEnabled && !replaySelectionMode}
                replayDate={chartFilter.replayDate}
                crosshairDate={crosshair?.timestamp ?? null}
                crosshairSourceId={crosshair?.sourceId ?? null}
                replaySelectionMode={replaySelectionMode}
                indicatorsHidden={hiddenIndicatorPanelIds.has(panel.id)}
                onIndicatorsHiddenChange={setPanelIndicatorsHidden}
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
