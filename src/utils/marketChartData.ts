import type { Dataset, VisibleTimeRange } from '../types/market'
import { findColumnByRole } from './dataset'
import { formatTimestampLabel, parseTimestampValue } from './dates'
import { parseNumber } from './numbers'

export interface MarketCandle {
  timestamp: string
  label: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface MarketDataModel {
  dataset: Dataset
  candles: MarketCandle[]
  totalRows: number
  validRows: number
  skippedRows: number
  duplicateRows: number
  ohlcDetected: boolean
  volumeDetected: boolean
  error: string | null
  warnings: string[]
}

export function filterCandlesForReplay(
  candles: MarketCandle[],
  replayEnabled: boolean,
  replayDate: string | null,
) {
  if (!replayEnabled || !replayDate) return candles
  const cutoff = replayDate.includes('T') ? replayDate : `${replayDate.slice(0, 10)}T23:59:59`
  return candles.filter((candle) => candle.timestamp <= cutoff)
}

export function buildMarketData(dataset: Dataset): MarketDataModel {
  const dateColumn = findColumnByRole(dataset, 'Date')
  const timeColumn = findColumnByRole(dataset, 'Time')
  const openColumn = findColumnByRole(dataset, 'Open')
  const highColumn = findColumnByRole(dataset, 'High')
  const lowColumn = findColumnByRole(dataset, 'Low')
  const closeColumn = findColumnByRole(dataset, 'Close')
  const volumeColumn = findColumnByRole(dataset, 'Volume')
  const sourceRows = dataset.rows.filter((row) =>
    dataset.columns.some((column) => row[column.id]?.trim()),
  )
  const totalRows = sourceRows.length
  const missing = [
    !dateColumn ? 'Date/Datetime' : '',
    !openColumn ? 'Open' : '',
    !highColumn ? 'High' : '',
    !lowColumn ? 'Low' : '',
    !closeColumn ? 'Close' : '',
  ].filter(Boolean)

  if (missing.length > 0) {
    return {
      dataset,
      candles: [],
      totalRows,
      validRows: 0,
      skippedRows: totalRows,
      duplicateRows: 0,
      ohlcDetected: false,
      volumeDetected: Boolean(volumeColumn),
      error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
      warnings: [],
    }
  }

  const requiredDateColumn = dateColumn!
  const requiredOpenColumn = openColumn!
  const requiredHighColumn = highColumn!
  const requiredLowColumn = lowColumn!
  const requiredCloseColumn = closeColumn!

  const byTimestamp = new Map<string, MarketCandle>()
  const invalidExamples: string[] = []
  let skippedRows = 0
  let duplicateRows = 0
  let invalidDates = 0
  let invalidNumbers = 0
  let normalizedOhlcRows = 0

  sourceRows.forEach((row, index) => {
    const timestamp = parseTimestampValue(
      row[requiredDateColumn.id] ?? '',
      timeColumn ? row[timeColumn.id] : undefined,
    )
    if (!timestamp) {
      skippedRows += 1
      invalidDates += 1
      if (invalidExamples.length < 3) {
        invalidExamples.push(`row ${index + 1}: invalid date "${row[requiredDateColumn.id] ?? ''}"`)
      }
      return
    }

    const open = parseNumber(row[requiredOpenColumn.id] ?? '')
    const high = parseNumber(row[requiredHighColumn.id] ?? '')
    const low = parseNumber(row[requiredLowColumn.id] ?? '')
    const close = parseNumber(row[requiredCloseColumn.id] ?? '')
    if (open === null || high === null || low === null || close === null) {
      skippedRows += 1
      invalidNumbers += 1
      if (invalidExamples.length < 3) invalidExamples.push(`row ${index + 1}: invalid OHLC value`)
      return
    }
    const normalizedHigh = Math.max(high, open, low, close)
    const normalizedLow = Math.min(low, open, high, close)
    if (normalizedHigh !== high || normalizedLow !== low) normalizedOhlcRows += 1

    const volume = volumeColumn ? parseNumber(row[volumeColumn.id] ?? '') : null
    if (byTimestamp.has(timestamp)) duplicateRows += 1
    byTimestamp.set(timestamp, {
      timestamp,
      label: formatTimestampLabel(timestamp),
      open,
      high: normalizedHigh,
      low: normalizedLow,
      close,
      volume,
    })
  })

  const candles = [...byTimestamp.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const warnings = [
    skippedRows > 0 ? `Skipped ${skippedRows} invalid row${skippedRows === 1 ? '' : 's'}.` : '',
    duplicateRows > 0 ? `Resolved ${duplicateRows} duplicate timestamp${duplicateRows === 1 ? '' : 's'} using the last row.` : '',
    normalizedOhlcRows > 0
      ? `Normalized High/Low bounds in ${normalizedOhlcRows} row${normalizedOhlcRows === 1 ? '' : 's'}.`
      : '',
    ...invalidExamples,
  ].filter(Boolean)
  let error: string | null = null
  if (candles.length === 0) {
    if (invalidDates === totalRows && totalRows > 0) {
      error = `Date column could not be parsed. ${invalidExamples[0] ?? ''}`.trim()
    } else if (invalidNumbers > 0) {
      error = `OHLC columns contain no complete numeric candles. ${invalidExamples[0] ?? ''}`.trim()
    } else {
      error = 'Dataset has no non-empty OHLC rows.'
    }
  }

  return {
    dataset,
    candles,
    totalRows,
    validRows: candles.length,
    skippedRows,
    duplicateRows,
    ohlcDetected: true,
    volumeDetected: Boolean(volumeColumn && candles.some((candle) => candle.volume !== null)),
    error,
    warnings,
  }
}

export function nearestTimestampIndex(timestamps: string[], target: string) {
  if (timestamps.length === 0) return -1
  let low = 0
  let high = timestamps.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const value = timestamps[middle]
    if (value === target) return middle
    if (value < target) low = middle + 1
    else high = middle - 1
  }
  if (low >= timestamps.length) return timestamps.length - 1
  if (high < 0) return 0
  const targetTime = timestampToMilliseconds(target)
  const lowTime = timestampToMilliseconds(timestamps[low])
  const highTime = timestampToMilliseconds(timestamps[high])
  return Math.abs(lowTime - targetTime) < Math.abs(targetTime - highTime) ? low : high
}

export function timeRangeToIndices(timestamps: string[], range: VisibleTimeRange) {
  if (timestamps.length === 0) return null
  const fromTime = timestampToMilliseconds(range.from)
  const toTime = timestampToMilliseconds(range.to)
  let low = 0
  let high = timestamps.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timestampToMilliseconds(timestamps[middle]) < fromTime) low = middle + 1
    else high = middle
  }
  const startIndex = Math.min(low, timestamps.length - 1)

  low = 0
  high = timestamps.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timestampToMilliseconds(timestamps[middle]) <= toTime) low = middle + 1
    else high = middle
  }
  const endIndex = Math.max(low - 1, 0)

  if (startIndex <= endIndex) return { startIndex, endIndex }
  const nearest = nearestTimestampIndex(timestamps, range.from)
  return { startIndex: nearest, endIndex: nearest }
}

function timestampToMilliseconds(value: string) {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  return Date.parse(value.includes('T') ? `${value}${hasTimezone ? '' : 'Z'}` : `${value}T00:00:00Z`)
}

export function buildFutureTimestamps(timestamps: string[], count: number) {
  if (timestamps.length === 0 || count <= 0) return []
  const recent = timestamps.slice(-65).map(timestampToMilliseconds)
  const intervals = recent.slice(1)
    .map((value, index) => value - recent[index])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  const day = 86_400_000
  const interval = intervals[Math.floor(Math.max(intervals.length - 1, 0) / 2)] ?? day
  const isDaily = interval >= day * 0.75 && interval <= day * 1.5
  const includesTime = timestamps.at(-1)!.includes('T')
  const output: string[] = []
  let cursor = timestampToMilliseconds(timestamps.at(-1)!)

  while (output.length < count) {
    cursor += isDaily ? day : interval
    const date = new Date(cursor)
    if (isDaily && (date.getUTCDay() === 0 || date.getUTCDay() === 6)) continue
    const iso = date.toISOString()
    output.push(includesTime ? iso.slice(0, 19) : iso.slice(0, 10))
  }
  return output
}

export function stepReplayTimestamp(timestamps: string[], currentTimestamp: string, direction: -1 | 1) {
  if (timestamps.length === 0) return null
  const cutoff = currentTimestamp.includes('T')
    ? currentTimestamp
    : `${currentTimestamp.slice(0, 10)}T23:59:59`
  let low = 0
  let high = timestamps.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (timestamps[middle] <= cutoff) low = middle + 1
    else high = middle
  }
  const currentIndex = low - 1
  const nextIndex = currentIndex < 0
    ? 0
    : Math.min(Math.max(currentIndex + direction, 0), timestamps.length - 1)
  return timestamps[nextIndex]
}
