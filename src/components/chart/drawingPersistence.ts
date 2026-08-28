import type { ChartDrawing, DrawingExportPayload, DrawingStyle, DrawingType } from '../../types/drawings'
import { DEFAULT_DRAWING_STYLE } from './drawingRegistry'

const STORAGE_PREFIX = 'market-data-visualizer.drawings.v1'
const FAVORITES_KEY = 'market-data-visualizer.drawing-favorites.v1'
const STYLE_DEFAULTS_KEY = 'market-data-visualizer.drawing-style-defaults.v1'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function sanitizeStyle(value: unknown): DrawingStyle {
  const candidate = isRecord(value) ? value : {}
  const fallback = DEFAULT_DRAWING_STYLE
  return {
    color: typeof candidate.color === 'string' ? candidate.color : fallback.color,
    fillColor: typeof candidate.fillColor === 'string' ? candidate.fillColor : fallback.fillColor,
    textColor: typeof candidate.textColor === 'string' ? candidate.textColor : fallback.textColor,
    backgroundColor: typeof candidate.backgroundColor === 'string' ? candidate.backgroundColor : fallback.backgroundColor,
    lineWidth: Math.min(Math.max(Number(candidate.lineWidth) || fallback.lineWidth, 1), 8),
    lineStyle: candidate.lineStyle === 'dashed' || candidate.lineStyle === 'dotted' ? candidate.lineStyle : 'solid',
    opacity: Math.min(Math.max(Number(candidate.opacity) || fallback.opacity, 0.05), 1),
    fillOpacity: Math.min(Math.max(Number(candidate.fillOpacity) || fallback.fillOpacity, 0), 1),
    fontSize: Math.min(Math.max(Number(candidate.fontSize) || fallback.fontSize, 9), 34),
    bold: candidate.bold === true,
    italic: candidate.italic === true,
    showFill: candidate.showFill !== false,
    extendLeft: candidate.extendLeft === true,
    extendRight: candidate.extendRight === true,
    text: typeof candidate.text === 'string' ? candidate.text : '',
    levels: Array.isArray(candidate.levels)
      ? candidate.levels.flatMap((level) => {
          if (!isRecord(level)) return []
          const numericValue = Number(level.value)
          if (!Number.isFinite(numericValue)) return []
          return [{
            value: numericValue,
            visible: level.visible !== false,
            color: typeof level.color === 'string' ? level.color : undefined,
          }]
        })
      : fallback.levels.map((level) => ({ ...level })),
  }
}

export function getDrawingStorageKey(layoutKey: string, panelId: string, symbolId: string) {
  return `${STORAGE_PREFIX}:${layoutKey}:${panelId}:${symbolId || 'none'}`
}

export function validateDrawings(value: unknown): ChartDrawing[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ChartDrawing[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') return []
    const points = Array.isArray(item.points)
      ? item.points.flatMap((point) => {
          if (!isRecord(point) || typeof point.timestamp !== 'string') return []
          const price = Number(point.price)
          return Number.isFinite(price) ? [{ timestamp: point.timestamp, price }] : []
        })
      : []
    if (points.length === 0) return []
    return [{
      id: item.id,
      type: item.type as ChartDrawing['type'],
      name: typeof item.name === 'string' ? item.name : item.type,
      symbol: typeof item.symbol === 'string' ? item.symbol : '',
      timeframe: typeof item.timeframe === 'string' ? item.timeframe : '1D',
      paneId: typeof item.paneId === 'string' ? item.paneId : 'price',
      points,
      style: sanitizeStyle(item.style),
      visible: item.visible !== false,
      locked: item.locked === true,
      zIndex: Number.isFinite(Number(item.zIndex)) ? Number(item.zIndex) : 1,
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now(),
      updatedAt: Number.isFinite(Number(item.updatedAt)) ? Number(item.updatedAt) : Date.now(),
    }]
  })
}

export function loadDrawings(key: string): ChartDrawing[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? validateDrawings(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveDrawings(key: string, drawings: ChartDrawing[]) {
  localStorage.setItem(key, JSON.stringify(drawings))
}

export function createDrawingExport(drawings: ChartDrawing[]): DrawingExportPayload {
  return { version: 1, exportedAt: Date.now(), drawings }
}

export function parseDrawingImport(value: string): ChartDrawing[] {
  const parsed = JSON.parse(value) as unknown
  if (isRecord(parsed) && parsed.version === 1 && Array.isArray(parsed.drawings)) {
    return validateDrawings(parsed.drawings)
  }
  return validateDrawings(parsed)
}

export function loadFavoriteTools() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveFavoriteTools(tools: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...new Set(tools)]))
}

export function loadDrawingStyleDefaults() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STYLE_DEFAULTS_KEY) ?? '{}') as unknown
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([type, style]) => {
        if (typeof type !== 'string' || !isRecord(style)) return []
        return [[type, sanitizeStyle(style)]]
      }),
    ) as Partial<Record<DrawingType, DrawingStyle>>
  } catch {
    return {}
  }
}

export function saveDrawingStyleDefault(type: DrawingType, style: DrawingStyle) {
  const current = loadDrawingStyleDefaults()
  current[type] = sanitizeStyle(style)
  localStorage.setItem(STYLE_DEFAULTS_KEY, JSON.stringify(current))
}
