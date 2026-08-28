import * as echarts from 'echarts'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ChartIndicatorConfig, ChartPanelConfig, Dataset, ThemeMode, VisibleTimeRange } from '../types/market'
import { formatNumber } from '../utils/numbers'
import { formatTimestampLabel } from '../utils/dates'
import {
  calculateAdx,
  calculateAtr,
  calculateBollinger,
  calculateEma,
  calculateIchimoku,
  calculateMacd,
  calculateObv,
  calculateRsi,
  calculateSma,
  calculateStochastic,
  calculateSupertrend,
  calculateVwap,
  calculateWma,
} from '../utils/indicators'
import { ChartDrawingWorkspace } from './chart/ChartDrawingWorkspace'
import {
  buildFutureTimestamps,
  buildMarketData,
  filterCandlesForReplay,
  nearestTimestampIndex,
  timeRangeToIndices,
} from '../utils/marketChartData'

export interface MarketChartHandle {
  fitContent: () => void
  getVisibleTimeRange: () => VisibleTimeRange | null
  setVisibleTimeRange: (range: VisibleTimeRange) => void
}

interface MarketChartProps {
  dataset?: Dataset
  config: ChartPanelConfig
  layoutKey: string
  theme: ThemeMode
  replayEnabled: boolean
  replayDate: string | null
  crosshairDate: string | null
  crosshairSourceId: string | null
  replaySelectionMode: boolean
  indicatorsHidden: boolean
  onIndicatorsHiddenChange: (panelId: string, hidden: boolean) => void
  onCrosshairChange: (panelId: string, timestamp: string | null) => void
  onReplayPointSelect: (panelId: string, timestamp: string) => void
  onVisibleTimeRangeChange: (panelId: string, range: VisibleTimeRange) => void
}

interface ViewportState {
  visibleCount: number
  endIndex: number
  followLatest: boolean
}

type PaneIndicatorConfig = Extract<ChartIndicatorConfig, { height: number; zoom: number }>
type NullableSeries = Array<number | null>

const PANE_INDICATOR_TYPES = new Set<ChartIndicatorConfig['type']>(['RSI', 'MACD', 'STOCHASTIC', 'ATR', 'ADX', 'OBV'])

function isPaneIndicator(indicator: ChartIndicatorConfig): indicator is PaneIndicatorConfig {
  return PANE_INDICATOR_TYPES.has(indicator.type)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function indicatorPaneWeight(indicator: PaneIndicatorConfig) {
  return clamp(Number(indicator.height) || 1.1, 0.55, 3)
}

function normalizeZoom(zoom: number) {
  return clamp(Number(zoom) || 1, 0.5, 5)
}

function indicatorZoom(indicator: PaneIndicatorConfig) {
  return normalizeZoom(indicator.zoom)
}

function seriesExtent(seriesList: NullableSeries[]) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  seriesList.forEach((series) => {
    series.forEach((value) => {
      if (value === null || !Number.isFinite(value)) return
      min = Math.min(min, value)
      max = Math.max(max, value)
    })
  })
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
}

function zoomedAxisRange(seriesList: NullableSeries[], zoom: number, fallbackCenter = 0) {
  const extent = seriesExtent(seriesList)
  if (!extent) return { min: undefined, max: undefined }
  const center = (extent.min + extent.max) / 2 || fallbackCenter
  const baseSpan = Math.max(extent.max - extent.min, Math.abs(center) * 0.12, 1)
  const span = baseSpan / normalizeZoom(zoom)
  return { min: center - span / 2, max: center + span / 2 }
}

function boundedOscillatorRange(zoom: number) {
  const span = 100 / normalizeZoom(zoom)
  return { min: 50 - span / 2, max: 50 + span / 2 }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] ?? character)
}

export const MarketChart = forwardRef<MarketChartHandle, MarketChartProps>(function MarketChart({
  dataset,
  config,
  layoutKey,
  theme,
  replayEnabled,
  replayDate,
  crosshairDate,
  crosshairSourceId,
  replaySelectionMode,
  indicatorsHidden,
  onIndicatorsHiddenChange,
  onCrosshairChange,
  onReplayPointSelect,
  onVisibleTimeRangeChange,
}, ref) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<echarts.ECharts | null>(null)
  const [chartInstance, setChartInstance] = useState<echarts.ECharts | null>(null)
  const [projectionVersion, setProjectionVersion] = useState(0)
  const timestampsRef = useRef<string[]>([])
  const timestampIndexRef = useRef<Map<string, number>>(new Map())
  const candleCountRef = useRef(0)
  const viewportRef = useRef<ViewportState | null>(null)
  const suppressTimeRangeEventRef = useRef(false)
  const suppressCrosshairRef = useRef(false)
  const replaySelectionModeRef = useRef(replaySelectionMode)
  const previousReplaySelectionModeRef = useRef(false)
  const replaySelectionConsumedRef = useRef(false)
  const onReplayPointSelectRef = useRef(onReplayPointSelect)
  const onVisibleTimeRangeChangeRef = useRef(onVisibleTimeRangeChange)
  if (replaySelectionMode && !previousReplaySelectionModeRef.current) {
    replaySelectionConsumedRef.current = false
  }
  previousReplaySelectionModeRef.current = replaySelectionMode
  replaySelectionModeRef.current = replaySelectionMode
  onReplayPointSelectRef.current = onReplayPointSelect
  onVisibleTimeRangeChangeRef.current = onVisibleTimeRangeChange
  const commitReplayPointRef = useRef<(timestamp: string) => void>(() => undefined)
  commitReplayPointRef.current = (timestamp) => {
    if (!replaySelectionModeRef.current || replaySelectionConsumedRef.current) return
    replaySelectionConsumedRef.current = true
    onReplayPointSelectRef.current(config.id, timestamp)
  }
  const model = useMemo(() => dataset ? buildMarketData(dataset) : null, [dataset])
  const visibleIndicators = useMemo(
    () => indicatorsHidden ? [] : config.indicators,
    [config.indicators, indicatorsHidden],
  )
  const candles = useMemo(
    () => model ? filterCandlesForReplay(model.candles, replayEnabled, replayDate) : [],
    [model, replayDate, replayEnabled],
  )
  const futureSlotCount = useMemo(() => Math.max(
    32,
    ...visibleIndicators
      .filter((indicator) => indicator.type === 'ICHIMOKU')
      .map((indicator) => indicator.kijun),
  ), [visibleIndicators])
  const timestamps = useMemo(() => {
    const history = candles.map((candle) => candle.timestamp)
    return [...history, ...buildFutureTimestamps(history, futureSlotCount)]
  }, [candles, futureSlotCount])
  const timestampIndex = useMemo(
    () => new Map(timestamps.map((timestamp, index) => [timestamp, index])),
    [timestamps],
  )
  timestampsRef.current = timestamps
  timestampIndexRef.current = timestampIndex
  candleCountRef.current = candles.length

  useEffect(() => {
    viewportRef.current = null
  }, [dataset?.id])

  useImperativeHandle(ref, () => ({
    fitContent() {
      const slotCount = timestampsRef.current.length
      viewportRef.current = {
        visibleCount: Math.max(slotCount, 1),
        endIndex: Math.max(slotCount - 1, 0),
        followLatest: true,
      }
      instanceRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
    },
    getVisibleTimeRange() {
      const chartTimestamps = timestampsRef.current
      const viewport = viewportRef.current
      if (chartTimestamps.length === 0 || !viewport) return null
      const endIndex = Math.min(Math.max(viewport.endIndex, 0), chartTimestamps.length - 1)
      const startIndex = Math.max(0, endIndex - viewport.visibleCount + 1)
      return { from: chartTimestamps[startIndex], to: chartTimestamps[endIndex] }
    },
    setVisibleTimeRange(range) {
      const chartTimestamps = timestampsRef.current
      const indices = timeRangeToIndices(chartTimestamps, range)
      const instance = instanceRef.current
      if (!indices || !instance) return
      viewportRef.current = {
        visibleCount: Math.max(indices.endIndex - indices.startIndex + 1, 2),
        endIndex: indices.endIndex,
        followLatest: indices.endIndex >= chartTimestamps.length - 2,
      }
      suppressTimeRangeEventRef.current = true
      instance.dispatchAction({
        type: 'dataZoom',
        batch: [
          { dataZoomIndex: 0, startValue: indices.startIndex, endValue: indices.endIndex },
          { dataZoomIndex: 1, startValue: indices.startIndex, endValue: indices.endIndex },
        ],
      })
      queueMicrotask(() => { suppressTimeRangeEventRef.current = false })
    },
  }), [])

  useEffect(() => {
    if (!chartRef.current) return
    const instance = echarts.init(chartRef.current, theme)
    instanceRef.current = instance
    setChartInstance(instance)
    const resizeObserver = new ResizeObserver(() => {
      instance.resize()
      setProjectionVersion((version) => version + 1)
    })
    resizeObserver.observe(chartRef.current)

    const handleAxisPointer = (...args: unknown[]) => {
      const event = args[0] as { axesInfo?: Array<{ value?: string | number }> }
      if (suppressCrosshairRef.current) {
        suppressCrosshairRef.current = false
        return
      }
      const rawValue = event.axesInfo?.[0]?.value
      const timestamps = timestampsRef.current
      const timestamp = typeof rawValue === 'number'
        ? timestamps[Math.round(rawValue)]
        : typeof rawValue === 'string' && timestamps[nearestTimestampIndex(timestamps, rawValue)] === rawValue
          ? rawValue
          : null
      if (timestamp) onCrosshairChange(config.id, timestamp)
    }
    const handleDataZoom = (...args: unknown[]) => {
      type ZoomPayload = {
        start?: number
        end?: number
        startValue?: string | number
        endValue?: string | number
      }
      const event = args[0] as ZoomPayload & { batch?: ZoomPayload[] }
      const timestamps = timestampsRef.current
      if (timestamps.length === 0) return
      const payload = event.batch?.[0] ?? event
      const start = payload.start ?? 0
      const end = payload.end ?? 100
      const resolveIndex = (value: string | number | undefined, percent: number, round: 'floor' | 'ceil') => {
        if (typeof value === 'string') return nearestTimestampIndex(timestamps, value)
        if (typeof value === 'number') return Math.round(value)
        const rawIndex = (percent / 100) * Math.max(timestamps.length - 1, 0)
        return round === 'floor' ? Math.floor(rawIndex) : Math.ceil(rawIndex)
      }
      const startIndex = Math.min(
        Math.max(resolveIndex(payload.startValue, start, 'floor'), 0),
        timestamps.length - 1,
      )
      const endIndex = Math.min(
        Math.max(resolveIndex(payload.endValue, end, 'ceil'), startIndex),
        timestamps.length - 1,
      )
      viewportRef.current = {
        visibleCount: Math.max(endIndex - startIndex + 1, 2),
        endIndex,
        followLatest: endIndex >= timestamps.length - 2,
      }
      setProjectionVersion((version) => version + 1)
      if (suppressTimeRangeEventRef.current) return
      onVisibleTimeRangeChangeRef.current(config.id, {
        from: timestamps[startIndex],
        to: timestamps[endIndex],
      })
    }
    let highlightedIndex = -1
    const pixelToIndex = (event: { offsetX: number; offsetY: number }) => {
      const converted = instance.convertFromPixel(
        { xAxisIndex: 0 },
        [event.offsetX, event.offsetY],
      ) as string | number | Array<string | number>
      const axisValue = Array.isArray(converted) ? converted[0] : converted
      return typeof axisValue === 'string'
        ? timestampIndexRef.current.get(axisValue) ?? -1
        : Math.round(Number(axisValue))
    }
    const updateReplayHighlight = (event: { offsetX: number; offsetY: number }) => {
      if (!replaySelectionModeRef.current) return
      if (!instance.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) return
      const index = pixelToIndex(event)
      if (!Number.isFinite(index) || index < 0 || index >= candleCountRef.current || index === highlightedIndex) return
      if (highlightedIndex >= 0) {
        instance.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: highlightedIndex })
      }
      highlightedIndex = index
      instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: index })
    }
    const handleReplayClick = (event: { offsetX: number; offsetY: number }) => {
      if (!replaySelectionModeRef.current) return
      if (!instance.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])) return
      const index = pixelToIndex(event)
      const timestamp = timestampsRef.current[index]
      if (index >= 0 && index < candleCountRef.current && timestamp) {
        commitReplayPointRef.current(timestamp)
      }
    }
    const handleGlobalOut = () => {
      if (highlightedIndex >= 0) {
        instance.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex: highlightedIndex })
        highlightedIndex = -1
      }
      onCrosshairChange(config.id, null)
    }

    instance.on('updateAxisPointer', handleAxisPointer)
    instance.on('datazoom', handleDataZoom)
    instance.getZr().on('mousemove', updateReplayHighlight)
    instance.getZr().on('click', handleReplayClick)
    instance.getZr().on('globalout', handleGlobalOut)

    return () => {
      resizeObserver.disconnect()
      instance.off('updateAxisPointer', handleAxisPointer)
      instance.off('datazoom', handleDataZoom)
      instance.getZr().off('mousemove', updateReplayHighlight)
      instance.getZr().off('click', handleReplayClick)
      instance.getZr().off('globalout', handleGlobalOut)
      instance.dispose()
      instanceRef.current = null
      setChartInstance(null)
    }
  }, [config.id, onCrosshairChange, theme])

  useEffect(() => {
    if (!replaySelectionMode) instanceRef.current?.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  }, [replaySelectionMode])

  useEffect(() => {
    const instance = instanceRef.current
    if (!instance) return
    if (!dataset || !model || model.error || candles.length === 0) {
      instance.clear()
      return
    }

    const closes = candles.map((candle) => candle.close)
    const highs = candles.map((candle) => candle.high)
    const lows = candles.map((candle) => candle.low)
    const volumes = candles.map((candle) => candle.volume)
    const paneIndicators = visibleIndicators.filter(isPaneIndicator)
    const smaConfigs = visibleIndicators.filter((indicator) => indicator.type === 'SMA')
    const emaConfigs = visibleIndicators.filter((indicator) => indicator.type === 'EMA')
    const wmaConfigs = visibleIndicators.filter((indicator) => indicator.type === 'WMA')
    const bollingerConfigs = visibleIndicators.filter((indicator) => indicator.type === 'BOLLINGER')
    const vwapConfigs = visibleIndicators.filter((indicator) => indicator.type === 'VWAP')
    const supertrendConfigs = visibleIndicators.filter((indicator) => indicator.type === 'SUPERTREND')
    const ichimokuConfigs = visibleIndicators.filter((indicator) => indicator.type === 'ICHIMOKU')
    const paneSpecs = [
      { id: 'price', weight: 3 },
      ...(model.volumeDetected ? [{ id: 'volume', weight: 0.75 }] : []),
      ...paneIndicators.map((indicator) => ({ id: indicator.id, weight: indicatorPaneWeight(indicator) })),
    ]
    const gap = 1.6
    const usableHeight = 88 - gap * Math.max(paneSpecs.length - 1, 0)
    const totalWeight = paneSpecs.reduce((sum, pane) => sum + pane.weight, 0)
    let top = 3
    const grids = paneSpecs.map((pane) => {
      const height = usableHeight * pane.weight / totalWeight
      const grid = { left: 54, right: 76, top: `${top}%`, height: `${height}%`, containLabel: false }
      top += height + gap
      return grid
    })
    const axisColor = theme === 'dark' ? '#758195' : '#64748b'
    const splitColor = theme === 'dark' ? '#1e2936' : '#e2e8f0'
    const xAxis = grids.map((_, index) => ({
      type: 'category',
      gridIndex: index,
      data: timestamps,
      boundaryGap: true,
      axisPointer: { show: true, label: { formatter: ({ value }: { value: string }) => formatTimestampLabel(value) } },
      axisLabel: {
        show: index === grids.length - 1,
        color: axisColor,
        hideOverlap: true,
        formatter: (value: string) => formatTimestampLabel(value).replace(/\//g, '-'),
      },
      axisLine: { lineStyle: { color: splitColor } },
      axisTick: { show: false },
      splitLine: { show: false },
    }))
    const yAxis = grids.map((_, index) => ({
      type: 'value',
      gridIndex: index,
      position: 'right',
      scale: index === 0,
      boundaryGap: index === 0 ? ['8%', '8%'] : undefined,
      min: undefined as number | undefined,
      max: undefined as number | undefined,
      axisLabel: { color: axisColor, formatter: (value: number) => formatNumber(value) },
      axisLine: { show: true, lineStyle: { color: splitColor } },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: splitColor, opacity: 0.7 } },
    }))
    const priceSeries: echarts.SeriesOption = config.chartType === 'line'
      ? {
          name: dataset.name,
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: closes,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          connectNulls: false,
          lineStyle: { width: 1.8, color: '#38bdf8' },
          itemStyle: { color: '#38bdf8' },
          emphasis: { focus: 'self', scale: 1.4 },
          z: 3,
        }
      : {
          name: dataset.name,
          type: 'candlestick',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
          barMinWidth: 1,
          barMaxWidth: 18,
          itemStyle: {
            color: '#00b894',
            color0: '#f04455',
            borderColor: '#00b894',
            borderColor0: '#f04455',
            borderWidth: 1,
          },
          emphasis: {
            itemStyle: {
              borderColor: '#f8fafc',
              borderColor0: '#f8fafc',
              borderWidth: 2,
            },
          },
          z: 3,
        }
    const series: echarts.SeriesOption[] = [priceSeries]

    let paneIndex = 1
    if (model.volumeDetected) {
      const volumePane = paneIndex
      series.push({
        name: 'Volume',
        type: 'bar',
        xAxisIndex: volumePane,
        yAxisIndex: volumePane,
        data: candles.map((candle) => candle.volume),
        itemStyle: {
          color: (params) => {
            const candle = candles[params.dataIndex]
            if (!candle) return 'transparent'
            return candle.close >= candle.open
              ? 'rgba(0, 184, 148, 0.55)'
              : 'rgba(240, 68, 85, 0.55)'
          },
        },
        barWidth: '65%',
        large: candles.length > 5000,
        largeThreshold: 5000,
      })
      paneIndex += 1
    }

    smaConfigs.forEach((indicator) => {
      series.push({
        name: `SMA ${indicator.period}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: calculateSma(closes, indicator.period),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.35, color: indicator.color },
        itemStyle: { color: indicator.color },
        z: 4,
      })
    })

    emaConfigs.forEach((indicator) => {
      series.push({
        name: `EMA ${indicator.period}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: calculateEma(closes, indicator.period),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.35, color: indicator.color },
        itemStyle: { color: indicator.color },
        z: 4,
      })
    })

    wmaConfigs.forEach((indicator) => {
      series.push({
        name: `WMA ${indicator.period}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: calculateWma(closes, indicator.period),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.25, color: indicator.color },
        itemStyle: { color: indicator.color },
        z: 4,
      })
    })

    bollingerConfigs.forEach((indicator) => {
      const bollinger = calculateBollinger(closes, indicator.period, indicator.multiplier)
      ;[
        { name: `BB Upper ${indicator.period}`, data: bollinger.upper, width: 1 },
        { name: `BB Basis ${indicator.period}`, data: bollinger.middle, width: 1.2 },
        { name: `BB Lower ${indicator.period}`, data: bollinger.lower, width: 1 },
      ].forEach((line) => series.push({
        name: line.name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: line.width, color: indicator.color, opacity: line.name.includes('Basis') ? 0.95 : 0.62 },
        itemStyle: { color: indicator.color },
        z: 3,
      }))
    })

    vwapConfigs.forEach((indicator) => {
      series.push({
        name: 'VWAP',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: calculateVwap(highs, lows, closes, volumes),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.45, color: indicator.color },
        itemStyle: { color: indicator.color },
        z: 5,
      })
    })

    supertrendConfigs.forEach((indicator) => {
      const supertrend = calculateSupertrend(highs, lows, closes, indicator.period, indicator.multiplier)
      const upLine = supertrend.line.map((value, index) => supertrend.direction[index] === 1 ? value : null)
      const downLine = supertrend.line.map((value, index) => supertrend.direction[index] === -1 ? value : null)
      ;[
        { name: `Supertrend Up ${indicator.period}/${indicator.multiplier}`, data: upLine, color: '#22c55e' },
        { name: `Supertrend Down ${indicator.period}/${indicator.multiplier}`, data: downLine, color: '#ef4444' },
      ].forEach((line) => series.push({
        name: line.name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.45, color: line.color },
        itemStyle: { color: line.color },
        z: 4,
      }))
    })

    ichimokuConfigs.forEach((indicator) => {
      const ichimoku = calculateIchimoku(
        highs,
        lows,
        indicator.tenkan,
        indicator.kijun,
        indicator.senkouB,
      )
      const cloudData: number[][] = []
      for (let index = 1; index < Math.min(timestamps.length, ichimoku.spanA.length); index += 1) {
        const currentA = ichimoku.spanA[index]
        const currentB = ichimoku.spanB[index]
        const previousA = ichimoku.spanA[index - 1]
        const previousB = ichimoku.spanB[index - 1]
        if (currentA !== null && currentB !== null && previousA !== null && previousB !== null) {
          cloudData.push([index, currentA, currentB, previousA, previousB])
        }
      }
      series.push({
        name: `Ichimoku Cloud ${indicator.tenkan}/${indicator.kijun}/${indicator.senkouB}`,
        type: 'custom',
        coordinateSystem: 'cartesian2d',
        xAxisIndex: 0,
        yAxisIndex: 0,
        silent: true,
        data: cloudData,
        renderItem: (_params, api) => {
          const index = Number(api.value(0))
          const currentA = Number(api.value(1))
          const currentB = Number(api.value(2))
          const previousA = Number(api.value(3))
          const previousB = Number(api.value(4))
          return {
            type: 'polygon',
            shape: {
              points: [
                api.coord([index - 1, previousA]),
                api.coord([index, currentA]),
                api.coord([index, currentB]),
                api.coord([index - 1, previousB]),
              ],
            },
            style: {
              fill: currentA >= currentB ? 'rgba(0, 184, 148, 0.16)' : 'rgba(240, 68, 85, 0.14)',
            },
          }
        },
        z: 1,
      } as echarts.SeriesOption)
      ;[
        { name: 'Tenkan-sen', data: ichimoku.tenkan, color: '#38bdf8' },
        { name: 'Kijun-sen', data: ichimoku.kijun, color: '#f59e0b' },
        { name: 'Senkou Span A', data: ichimoku.spanA, color: '#22c55e' },
        { name: 'Senkou Span B', data: ichimoku.spanB, color: '#ef4444' },
      ].forEach((line) => series.push({
        name: line.name,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: line.data,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: line.color },
        itemStyle: { color: line.color },
        z: 4,
      }))
    })

    paneIndicators.forEach((indicator) => {
      const currentPane = paneIndex
      const paneZoom = indicatorZoom(indicator)

      if (indicator.type === 'RSI') {
        const rsi = calculateRsi(closes, indicator.period)
        yAxis[currentPane] = { ...yAxis[currentPane], ...boundedOscillatorRange(paneZoom), scale: false }
        series.push({
          name: `RSI ${indicator.period}`,
          type: 'line',
          xAxisIndex: currentPane,
          yAxisIndex: currentPane,
          data: rsi,
          showSymbol: false,
          lineStyle: { width: 1.4, color: '#a78bfa' },
          itemStyle: { color: '#a78bfa' },
          markLine: {
            symbol: 'none',
            label: { show: false },
            lineStyle: { type: 'dashed', color: '#64748b' },
            data: [{ yAxis: 70 }, { yAxis: 30 }],
          },
        })
      }

      if (indicator.type === 'MACD') {
        const macd = calculateMacd(closes, indicator.fast, indicator.slow, indicator.signal)
        yAxis[currentPane] = { ...yAxis[currentPane], ...zoomedAxisRange([macd.macd, macd.signal, macd.histogram], paneZoom), scale: true }
        series.push(
          {
            name: 'MACD',
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: macd.macd,
            showSymbol: false,
            lineStyle: { width: 1.3, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
          },
          {
            name: 'Signal',
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: macd.signal,
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#f59e0b' },
            itemStyle: { color: '#f59e0b' },
          },
          {
            name: 'MACD Histogram',
            type: 'bar',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: macd.histogram,
            itemStyle: {
              color: (params) => Number(params.value ?? 0) >= 0 ? '#00b894' : '#f04455',
            },
          },
        )
      }

      if (indicator.type === 'STOCHASTIC') {
        const stochastic = calculateStochastic(highs, lows, closes, indicator.kPeriod, indicator.dPeriod)
        yAxis[currentPane] = { ...yAxis[currentPane], ...boundedOscillatorRange(paneZoom), scale: false }
        series.push(
          {
            name: `%K ${indicator.kPeriod}`,
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: stochastic.k,
            showSymbol: false,
            lineStyle: { width: 1.25, color: '#38bdf8' },
            itemStyle: { color: '#38bdf8' },
            markLine: {
              symbol: 'none',
              label: { show: false },
              lineStyle: { type: 'dashed', color: '#64748b' },
              data: [{ yAxis: 80 }, { yAxis: 20 }],
            },
          },
          {
            name: `%D ${indicator.dPeriod}`,
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: stochastic.d,
            showSymbol: false,
            lineStyle: { width: 1.2, color: '#f59e0b' },
            itemStyle: { color: '#f59e0b' },
          },
        )
      }

      if (indicator.type === 'ATR') {
        const atr = calculateAtr(highs, lows, closes, indicator.period)
        const axisRange = zoomedAxisRange([atr], paneZoom)
        yAxis[currentPane] = {
          ...yAxis[currentPane],
          min: axisRange.min === undefined ? undefined : Math.max(0, axisRange.min),
          max: axisRange.max,
          scale: true,
        }
        series.push({
          name: `ATR ${indicator.period}`,
          type: 'line',
          xAxisIndex: currentPane,
          yAxisIndex: currentPane,
          data: atr,
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#fb923c' },
          itemStyle: { color: '#fb923c' },
        })
      }

      if (indicator.type === 'ADX') {
        const adx = calculateAdx(highs, lows, closes, indicator.period)
        yAxis[currentPane] = { ...yAxis[currentPane], ...boundedOscillatorRange(paneZoom), scale: false }
        series.push(
          {
            name: `ADX ${indicator.period}`,
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: adx.adx,
            showSymbol: false,
            lineStyle: { width: 1.35, color: '#f8fafc' },
            itemStyle: { color: '#f8fafc' },
            markLine: {
              symbol: 'none',
              label: { show: false },
              lineStyle: { type: 'dashed', color: '#64748b' },
              data: [{ yAxis: 25 }],
            },
          },
          {
            name: '+DI',
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: adx.plusDi,
            showSymbol: false,
            lineStyle: { width: 1.15, color: '#22c55e' },
            itemStyle: { color: '#22c55e' },
          },
          {
            name: '-DI',
            type: 'line',
            xAxisIndex: currentPane,
            yAxisIndex: currentPane,
            data: adx.minusDi,
            showSymbol: false,
            lineStyle: { width: 1.15, color: '#ef4444' },
            itemStyle: { color: '#ef4444' },
          },
        )
      }

      if (indicator.type === 'OBV') {
        const obv = calculateObv(closes, volumes)
        yAxis[currentPane] = { ...yAxis[currentPane], ...zoomedAxisRange([obv], paneZoom), scale: true }
        series.push({
          name: 'OBV',
          type: 'line',
          xAxisIndex: currentPane,
          yAxisIndex: currentPane,
          data: obv,
          showSymbol: false,
          lineStyle: { width: 1.3, color: '#14b8a6' },
          itemStyle: { color: '#14b8a6' },
        })
      }

      paneIndex += 1
    })

    const viewport = viewportRef.current
    const visibleCount = Math.min(viewport?.visibleCount ?? 140, timestamps.length)
    const endValue = viewport?.followLatest === false
      ? Math.min(viewport.endIndex, timestamps.length - 1)
      : timestamps.length - 1
    const startValue = Math.max(0, endValue - visibleCount + 1)
    viewportRef.current = { visibleCount, endIndex: endValue, followLatest: viewport?.followLatest ?? true }

    instance.setOption({
      backgroundColor: 'transparent',
      animation: false,
      grid: grids,
      xAxis,
      yAxis,
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: '#334155' } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        confine: true,
        backgroundColor: theme === 'dark' ? 'rgba(10, 15, 22, 0.94)' : 'rgba(255,255,255,0.96)',
        borderColor: splitColor,
        textStyle: { color: theme === 'dark' ? '#e5edf7' : '#0f172a' },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const candle = candles[params[0]?.dataIndex]
          if (!candle) return ''
          return [
            `<strong>${escapeHtml(dataset.name)}</strong> &nbsp; ${escapeHtml(candle.label)}`,
            `O ${formatNumber(candle.open)} &nbsp; H ${formatNumber(candle.high)}`,
            `L ${formatNumber(candle.low)} &nbsp; C ${formatNumber(candle.close)}`,
            candle.volume === null ? '' : `Vol ${formatNumber(candle.volume)}`,
          ].filter(Boolean).join('<br/>')
        },
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: grids.map((_, index) => index),
          startValue,
          endValue,
          filterMode: 'filter',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          throttle: 32,
        },
        {
          type: 'slider',
          xAxisIndex: grids.map((_, index) => index),
          startValue,
          endValue,
          filterMode: 'filter',
          height: 18,
          bottom: 2,
          borderColor: splitColor,
          fillerColor: 'rgba(56, 189, 248, 0.12)',
          handleStyle: { color: '#64748b' },
          textStyle: { color: axisColor },
        },
      ],
      series,
    }, true)
    setProjectionVersion((version) => version + 1)
  }, [candles, config.chartType, dataset, model, theme, timestamps, visibleIndicators])

  useEffect(() => {
    const instance = instanceRef.current
    if (!instance) return
    if (!crosshairDate) {
      instance.dispatchAction({ type: 'hideTip' })
      return
    }
    if (crosshairSourceId === config.id) return
    const timestamps = timestampsRef.current
    const index = nearestTimestampIndex(timestamps, crosshairDate)
    if (index < 0) return
    suppressCrosshairRef.current = true
    instance.dispatchAction({ type: 'updateAxisPointer', xAxisIndex: 0, value: timestamps[index] })
    instance.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: index })
  }, [config.id, crosshairDate, crosshairSourceId])

  const error = !dataset
    ? 'No symbol selected.'
    : model?.error
      ? model.error
      : replayEnabled && candles.length === 0
        ? `No candles exist on or before ${replayDate}.`
        : null

  return (
    <div
      className={`market-chart-host${replaySelectionMode ? ' replay-selecting' : ''}`}
      onClickCapture={() => {
        if (crosshairSourceId === config.id && crosshairDate) {
          commitReplayPointRef.current(crosshairDate)
        }
      }}
    >
      <div ref={chartRef} className="market-chart-canvas" />
      <ChartDrawingWorkspace
        chart={chartInstance}
        layoutKey={layoutKey}
        panelId={config.id}
        symbolId={dataset?.id ?? ''}
        symbol={dataset?.name ?? ''}
        timeframe="1D"
        timestamps={timestamps}
        candles={candles}
        disabled={Boolean(error) || replaySelectionMode}
        projectionVersion={projectionVersion}
        indicatorsHidden={indicatorsHidden}
        onIndicatorsHiddenChange={(hidden) => onIndicatorsHiddenChange(config.id, hidden)}
        onResetChart={() => instanceRef.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })}
      />
      {error && (
        <div className="chart-error-state">
          <strong>Cannot render {dataset?.name ?? 'chart'}</strong>
          <span>{error}</span>
        </div>
      )}
      {!error && model && model.warnings.length > 0 && (
        <div className="chart-warning" title={model.warnings.join('\n')}>
          {model.validRows.toLocaleString()} valid / {model.totalRows.toLocaleString()} rows
        </div>
      )}
    </div>
  )
})
