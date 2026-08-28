import type * as echarts from 'echarts'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { ChartDrawing, DrawingPoint, DrawingStyle, DrawingTool, DrawingType, MagnetMode } from '../../types/drawings'
import type { MarketCandle } from '../../utils/marketChartData'
import { nearestTimestampIndex } from '../../utils/marketChartData'
import { createId } from '../../utils/ids'
import { DrawingContextMenu, type DrawingContextMenuState } from './DrawingContextMenu'
import { DrawingManager } from './DrawingManager'
import { DrawingStyleToolbar } from './DrawingStyleToolbar'
import { DrawingToolbar } from './DrawingToolbar'
import { DRAWING_TOOL_MAP, getDefaultStyle, getDrawingName, isDrawingType } from './drawingRegistry'
import {
  createDrawingExport,
  getDrawingStorageKey,
  loadDrawingStyleDefaults,
  loadDrawings,
  loadFavoriteTools,
  parseDrawingImport,
  saveDrawingStyleDefault,
  saveDrawings,
  saveFavoriteTools,
} from './drawingPersistence'

interface ChartDrawingWorkspaceProps {
  chart: echarts.ECharts | null
  layoutKey: string
  panelId: string
  symbolId: string
  symbol: string
  timeframe: string
  timestamps: string[]
  candles: MarketCandle[]
  disabled: boolean
  projectionVersion: number
  indicatorsHidden: boolean
  onIndicatorsHiddenChange: (hidden: boolean) => void
  onResetChart: () => void
}

interface ScreenPoint {
  x: number
  y: number
}

interface DraftDrawing {
  type: DrawingType
  points: DrawingPoint[]
  preview: DrawingPoint | null
}

interface DragState {
  id: string
  mode: 'move' | 'point'
  pointIndex: number | null
  startPoint: DrawingPoint
  startDrawings: ChartDrawing[]
}

const TWO_POINT_DRAG_TOOLS = new Set<DrawingType>([
  'trendLine',
  'ray',
  'extendedLine',
  'rectangle',
  'ellipse',
  'fibonacci',
  'priceChannel',
  'arrow',
  'callout',
  'priceRange',
  'dateRange',
  'datePriceRange',
  'longPosition',
  'shortPosition',
])

function formatNumber(value: number) {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value)
}

function lineDash(style: DrawingStyle) {
  if (style.lineStyle === 'dashed') return '8 6'
  if (style.lineStyle === 'dotted') return '2 5'
  return undefined
}

function daysBetween(a: string, b: string) {
  const from = Date.parse(a.includes('T') ? a : `${a}T00:00:00Z`)
  const to = Date.parse(b.includes('T') ? b : `${b}T00:00:00Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.round(Math.abs(to - from) / 86_400_000)
}

function distance(a: ScreenPoint, b: ScreenPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function cloneDrawing(drawing: ChartDrawing): ChartDrawing {
  return {
    ...drawing,
    points: drawing.points.map((point) => ({ ...point })),
    style: {
      ...drawing.style,
      levels: drawing.style.levels.map((level) => ({ ...level })),
    },
  }
}

function isTextLikeDrawing(type: DrawingType) {
  return type === 'text' || type === 'note' || type === 'callout' || type === 'priceLabel'
}

function cloneStyle(style: DrawingStyle): DrawingStyle {
  return { ...style, levels: style.levels.map((level) => ({ ...level })) }
}

export function ChartDrawingWorkspace({
  chart,
  layoutKey,
  panelId,
  symbolId,
  symbol,
  timeframe,
  timestamps,
  candles,
  disabled,
  projectionVersion,
  indicatorsHidden,
  onIndicatorsHiddenChange,
  onResetChart,
}: ChartDrawingWorkspaceProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const storageKey = useMemo(() => getDrawingStorageKey(layoutKey, panelId, symbolId), [layoutKey, panelId, symbolId])
  const [drawings, setDrawings] = useState<ChartDrawing[]>(() => loadDrawings(storageKey))
  const [past, setPast] = useState<ChartDrawing[][]>([])
  const [future, setFuture] = useState<ChartDrawing[][]>([])
  const [activeTool, setActiveTool] = useState<DrawingTool>('crosshair')
  const [magnetMode, setMagnetMode] = useState<MagnetMode>('off')
  const [keepDrawing, setKeepDrawing] = useState(false)
  const [lockedAll, setLockedAll] = useState(false)
  const [drawingsHidden, setDrawingsHidden] = useState(false)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftDrawing | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<DrawingContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<ChartDrawing | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [favoriteTools, setFavoriteTools] = useState<DrawingTool[]>(() => loadFavoriteTools() as DrawingTool[])
  const [styleDefaults, setStyleDefaults] = useState<Partial<Record<DrawingType, DrawingStyle>>>(() => loadDrawingStyleDefaults())
  const creationStartRef = useRef<{ point: DrawingPoint; screen: ScreenPoint; type: DrawingType } | null>(null)
  const brushDrawingRef = useRef<ChartDrawing | null>(null)
  const keyboardStateRef = useRef({
    selectedDrawingId: null as string | null,
    selectedDrawing: null as ChartDrawing | null,
    clipboard: null as ChartDrawing | null,
    drawings: [] as ChartDrawing[],
    maxZ: 0,
  })
  const keyboardActionsRef = useRef({
    deleteDrawing: (_id: string) => undefined as void,
    undo: () => undefined as void,
    redo: () => undefined as void,
    shiftDrawing: (drawing: ChartDrawing, _deltaIndex: number, _deltaPrice: number) => drawing,
    commit: (_drawings: ChartDrawing[]) => undefined as void,
  })

  const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId) ?? null
  const maxZ = drawings.reduce((max, drawing) => Math.max(max, drawing.zIndex), 0)
  const svgWidth = chart?.getWidth() ?? 0
  const svgHeight = chart?.getHeight() ?? 0
  void projectionVersion

  useEffect(() => {
    const next = loadDrawings(storageKey)
    setDrawings(next)
    setPast([])
    setFuture([])
    setSelectedDrawingId(null)
    setDraft(null)
  }, [storageKey])

  useEffect(() => {
    saveDrawings(storageKey, drawings)
  }, [drawings, storageKey])

  useEffect(() => {
    saveFavoriteTools(favoriteTools)
  }, [favoriteTools])

  function commit(nextDrawings: ChartDrawing[], previousDrawings = drawings) {
    setPast((items) => [...items.slice(-79), previousDrawings.map(cloneDrawing)])
    setFuture([])
    setDrawings(nextDrawings)
  }

  function replaceDrawing(id: string, updater: (drawing: ChartDrawing) => ChartDrawing, record = true) {
    const previous = drawings
    const next = drawings.map((drawing) => drawing.id === id ? updater(cloneDrawing(drawing)) : drawing)
    if (record) commit(next, previous)
    else setDrawings(next)
  }

  function defaultStyleForTool(type: DrawingType) {
    const base = getDefaultStyle(type)
    const saved = styleDefaults[type]
    if (!saved) return base
    return { ...base, ...cloneStyle(saved), levels: saved.levels.map((level) => ({ ...level })) }
  }

  function pointerPosition(event: PointerEvent<SVGElement>): ScreenPoint | null {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function project(point: DrawingPoint): ScreenPoint | null {
    if (!chart || timestamps.length === 0) return null
    const index = nearestTimestampIndex(timestamps, point.timestamp)
    if (index < 0) return null
    const converted = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [index, point.price]) as unknown
    if (!Array.isArray(converted)) return null
    const [x, y] = converted.map(Number)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  }

  function pointFromScreen(screen: ScreenPoint, snap = true): DrawingPoint | null {
    if (!chart || timestamps.length === 0) return null
    if (!chart.containPixel({ gridIndex: 0 }, [screen.x, screen.y])) return null
    const converted = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [screen.x, screen.y]) as unknown
    if (!Array.isArray(converted)) return null
    const rawIndex = Math.round(Number(converted[0]))
    const price = Number(converted[1])
    if (!Number.isFinite(rawIndex) || !Number.isFinite(price)) return null
    const index = Math.min(Math.max(rawIndex, 0), timestamps.length - 1)
    const point = { timestamp: timestamps[index], price }
    return snap ? snapPoint(point, screen) : point
  }

  function snapPoint(point: DrawingPoint, screen: ScreenPoint): DrawingPoint {
    if (magnetMode === 'off' || candles.length === 0) return point
    const index = nearestTimestampIndex(candles.map((candle) => candle.timestamp), point.timestamp)
    const candidates = magnetMode === 'strong'
      ? candles.slice(Math.max(index, 0), Math.max(index, 0) + 1)
      : candles.slice(Math.max(index - 2, 0), Math.min(index + 3, candles.length))
    let bestPoint: DrawingPoint | null = null
    let bestDistance = Number.POSITIVE_INFINITY
    candidates.forEach((candle) => {
      ;[
        candle.open,
        candle.high,
        candle.low,
        candle.close,
      ].forEach((price) => {
        const candidate = { timestamp: candle.timestamp, price }
        const projected = project(candidate)
        if (!projected) return
        const currentDistance = distance(projected, screen)
        if (currentDistance < bestDistance) {
          bestPoint = candidate
          bestDistance = currentDistance
        }
      })
    })
    if (!bestPoint) return point
    return magnetMode === 'strong' || bestDistance <= 18 ? bestPoint : point
  }

  function normalizePoints(type: DrawingType, points: DrawingPoint[]) {
    if (type === 'longPosition' || type === 'shortPosition') {
      const entry = points[0]
      const end = points[1] ?? points[0]
      const rawMove = Math.abs(end.price - entry.price)
      const move = Math.max(rawMove, Math.abs(entry.price) * 0.01, 1)
      const targetPrice = type === 'longPosition'
        ? Math.max(end.price, entry.price + move)
        : Math.min(end.price, entry.price - move)
      const stopPrice = type === 'longPosition' ? entry.price - move * 0.5 : entry.price + move * 0.5
      return [
        entry,
        { timestamp: end.timestamp, price: entry.price },
        { timestamp: end.timestamp, price: targetPrice },
        { timestamp: end.timestamp, price: stopPrice },
      ]
    }
    return points
  }

  function createDrawing(type: DrawingType, rawPoints: DrawingPoint[]) {
    const points = normalizePoints(type, rawPoints)
    if (points.length === 0) return null
    const now = Date.now()
    const style = defaultStyleForTool(type)
    if (isTextLikeDrawing(type)) style.text = style.text || DRAWING_TOOL_MAP.get(type)?.label || 'Text'
    const sameTypeCount = drawings.filter((drawing) => drawing.type === type).length
    return {
      id: createId('drawing'),
      type,
      name: getDrawingName(type, sameTypeCount + 1),
      symbol,
      timeframe,
      paneId: 'price',
      points,
      style,
      visible: true,
      locked: false,
      zIndex: maxZ + 1,
      createdAt: now,
      updatedAt: now,
    } satisfies ChartDrawing
  }

  function addDrawing(type: DrawingType, points: DrawingPoint[]) {
    const drawing = createDrawing(type, points)
    if (!drawing) return
    commit([...drawings, drawing])
    setSelectedDrawingId(drawing.id)
    if (isTextLikeDrawing(type)) setEditingTextId(drawing.id)
    setDraft(null)
    creationStartRef.current = null
    if (!keepDrawing) setActiveTool('select')
  }

  function handleCanvasPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (disabled || activeTool === 'crosshair' || activeTool === 'dot' || activeTool === 'select') {
      setSelectedDrawingId(null)
      return
    }
    const screen = pointerPosition(event)
    if (!screen || !isDrawingType(activeTool)) return
    const point = pointFromScreen(screen)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    if (activeTool === 'brush') {
      const drawing = createDrawing('brush', [point])
      brushDrawingRef.current = drawing
      setDraft({ type: 'brush', points: [point], preview: null })
      return
    }

    const definition = DRAWING_TOOL_MAP.get(activeTool)
    if (!definition) return
    if (definition.minPoints === 1) {
      addDrawing(activeTool, [point])
      return
    }

    if (!draft || draft.type !== activeTool) {
      setDraft({ type: activeTool, points: [point], preview: point })
      if (TWO_POINT_DRAG_TOOLS.has(activeTool)) creationStartRef.current = { point, screen, type: activeTool }
      return
    }

    const nextPoints = [...draft.points, point]
    if (nextPoints.length >= definition.minPoints) addDrawing(activeTool, nextPoints)
    else setDraft({ ...draft, points: nextPoints, preview: point })
  }

  function handleCanvasPointerMove(event: PointerEvent<SVGSVGElement>) {
    const screen = pointerPosition(event)
    if (!screen) return
    const point = pointFromScreen(screen)
    if (!point) return

    if (dragState) {
      updateDrag(point)
      return
    }

    if (brushDrawingRef.current && draft?.type === 'brush') {
      setDraft((current) => current ? { ...current, points: [...current.points, point] } : current)
      return
    }

    if (draft) setDraft({ ...draft, preview: point })
  }

  function handleCanvasPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (dragState) {
      const changed = JSON.stringify(dragState.startDrawings) !== JSON.stringify(drawings)
      if (changed) {
        setPast((items) => [...items.slice(-79), dragState.startDrawings.map(cloneDrawing)])
        setFuture([])
      }
      setDragState(null)
      return
    }

    if (brushDrawingRef.current && draft?.type === 'brush') {
      if (draft.points.length > 1) addDrawing('brush', draft.points)
      else setDraft(null)
      brushDrawingRef.current = null
      return
    }

    const creation = creationStartRef.current
    if (!creation || !draft || draft.type !== creation.type) return
    const screen = pointerPosition(event)
    const point = screen ? pointFromScreen(screen) : null
    if (point && screen && distance(screen, creation.screen) > 6) addDrawing(creation.type, [creation.point, point])
    creationStartRef.current = null
  }

  function updateDrag(point: DrawingPoint) {
    if (!dragState) return
    const startIndex = nearestTimestampIndex(timestamps, dragState.startPoint.timestamp)
    const currentIndex = nearestTimestampIndex(timestamps, point.timestamp)
    const deltaIndex = currentIndex - startIndex
    const deltaPrice = point.price - dragState.startPoint.price

    setDrawings(dragState.startDrawings.map((drawing) => {
      if (drawing.id !== dragState.id || (drawing.locked || lockedAll)) return drawing
      const next = cloneDrawing(drawing)
      next.updatedAt = Date.now()
      if (dragState.mode === 'point' && dragState.pointIndex !== null) {
        next.points[dragState.pointIndex] = point
        if ((next.type === 'longPosition' || next.type === 'shortPosition') && dragState.pointIndex === 0 && next.points[1]) {
          next.points[1] = { ...next.points[1], price: point.price }
        }
        return next
      }
      next.points = next.points.map((drawingPoint) => {
        const index = nearestTimestampIndex(timestamps, drawingPoint.timestamp)
        return {
          timestamp: timestamps[Math.min(Math.max(index + deltaIndex, 0), timestamps.length - 1)] ?? drawingPoint.timestamp,
          price: drawingPoint.price + deltaPrice,
        }
      })
      return next
    }))
  }

  function startDrag(event: PointerEvent<SVGElement>, drawingId: string, mode: 'move' | 'point', pointIndex: number | null = null) {
    const point = pointFromScreen(pointerPosition(event) ?? { x: 0, y: 0 }, false)
    const drawing = drawings.find((item) => item.id === drawingId)
    if (!point || !drawing || drawing.locked || lockedAll || activeTool === 'eraser') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedDrawingId(drawingId)
    setDragState({
      id: drawingId,
      mode,
      pointIndex,
      startPoint: point,
      startDrawings: drawings.map(cloneDrawing),
    })
  }

  function handleDrawingPointerDown(event: PointerEvent<SVGElement>, drawingId: string) {
    event.stopPropagation()
    if (activeTool === 'eraser') {
      deleteDrawing(drawingId)
      return
    }
    setSelectedDrawingId(drawingId)
    if (activeTool === 'select') startDrag(event, drawingId, 'move')
  }

  function deleteDrawing(id: string) {
    const next = drawings.filter((drawing) => drawing.id !== id)
    commit(next)
    if (selectedDrawingId === id) setSelectedDrawingId(null)
  }

  function cloneSelected() {
    if (!selectedDrawing) return
    const clone = cloneDrawing(selectedDrawing)
    clone.id = createId('drawing')
    clone.name = `${selectedDrawing.name} copy`
    clone.zIndex = maxZ + 1
    clone.createdAt = Date.now()
    clone.updatedAt = Date.now()
    const shifted = shiftDrawing(clone, 4, selectedDrawing.points[0]?.price ? Math.abs(selectedDrawing.points[0].price) * 0.01 : 1)
    commit([...drawings, shifted])
    setSelectedDrawingId(shifted.id)
  }

  function shiftDrawing(drawing: ChartDrawing, deltaIndex: number, deltaPrice: number) {
    const next = cloneDrawing(drawing)
    next.points = next.points.map((point) => {
      const index = nearestTimestampIndex(timestamps, point.timestamp)
      return {
        timestamp: timestamps[Math.min(Math.max(index + deltaIndex, 0), timestamps.length - 1)] ?? point.timestamp,
        price: point.price + deltaPrice,
      }
    })
    return next
  }

  function updateStyle(patch: Partial<DrawingStyle>) {
    if (!selectedDrawing) return
    const nextStyle = { ...selectedDrawing.style, ...patch, levels: selectedDrawing.style.levels.map((level) => ({ ...level })) }
    const rememberedStyle = {
      ...nextStyle,
      text: getDefaultStyle(selectedDrawing.type).text,
    }
    setStyleDefaults((current) => ({ ...current, [selectedDrawing.type]: rememberedStyle }))
    saveDrawingStyleDefault(selectedDrawing.type, rememberedStyle)
    replaceDrawing(selectedDrawing.id, (drawing) => ({
      ...drawing,
      style: { ...drawing.style, ...patch },
      updatedAt: Date.now(),
    }))
  }

  function undo() {
    setPast((items) => {
      const previous = items.at(-1)
      if (!previous) return items
      setFuture((redos) => [drawings.map(cloneDrawing), ...redos.slice(0, 79)])
      setDrawings(previous.map(cloneDrawing))
      setSelectedDrawingId(null)
      return items.slice(0, -1)
    })
  }

  function redo() {
    setFuture((items) => {
      const next = items[0]
      if (!next) return items
      setPast((undos) => [...undos.slice(-79), drawings.map(cloneDrawing)])
      setDrawings(next.map(cloneDrawing))
      setSelectedDrawingId(null)
      return items.slice(1)
    })
  }

  function exportDrawings() {
    const blob = new Blob([JSON.stringify(createDrawingExport(drawings), null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${symbol || 'chart'}-drawings.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function importDrawings(text: string) {
    try {
      const imported = parseDrawingImport(text)
      if (imported.length === 0) {
        window.alert('No valid drawings found in this file.')
        return
      }
      const shouldReplace = window.confirm('Replace current drawings? Choose Cancel to append them instead.')
      const normalized = imported.map((drawing, index) => ({
        ...drawing,
        id: createId('drawing'),
        symbol,
        timeframe,
        zIndex: maxZ + index + 1,
        updatedAt: Date.now(),
      }))
      commit(shouldReplace ? normalized : [...drawings, ...normalized])
    } catch {
      window.alert('Import failed. The JSON file is not valid.')
    }
  }

  function removeAllDrawings() {
    if (drawings.length === 0) return
    if (!window.confirm('Remove all drawings on this chart?')) return
    commit([])
    setSelectedDrawingId(null)
  }

  function handleContextMenu(event: PointerEvent<SVGSVGElement>) {
    event.preventDefault()
    const rect = svgRef.current?.getBoundingClientRect()
    setContextMenu({
      x: rect ? event.clientX - rect.left : event.clientX,
      y: rect ? event.clientY - rect.top : event.clientY,
      drawingId: null,
    })
  }

  function handleDrawingContextMenu(event: PointerEvent<SVGElement>, drawingId: string) {
    event.preventDefault()
    event.stopPropagation()
    const rect = svgRef.current?.getBoundingClientRect()
    setSelectedDrawingId(drawingId)
    setContextMenu({
      x: rect ? event.clientX - rect.left : event.clientX,
      y: rect ? event.clientY - rect.top : event.clientY,
      drawingId,
    })
  }

  function toggleFavorite(tool: DrawingTool) {
    setFavoriteTools((current) => current.includes(tool)
      ? current.filter((item) => item !== tool)
      : [...current, tool])
  }

  keyboardStateRef.current = { selectedDrawingId, selectedDrawing, clipboard, drawings, maxZ }
  keyboardActionsRef.current = { deleteDrawing, undo, redo, shiftDrawing, commit }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const state = keyboardStateRef.current
      const actions = keyboardActionsRef.current
      const target = event.target as HTMLElement | null
      if (target?.matches('input, select, textarea') || target?.isContentEditable) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setDraft(null)
        setSelectedDrawingId(null)
        setActiveTool('crosshair')
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedDrawingId) {
        event.preventDefault()
        actions.deleteDrawing(state.selectedDrawingId)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        actions.undo()
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        actions.redo()
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'c' && state.selectedDrawing) {
        event.preventDefault()
        setClipboard(cloneDrawing(state.selectedDrawing))
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && state.clipboard) {
        event.preventDefault()
        const clone = actions.shiftDrawing({ ...cloneDrawing(state.clipboard), id: createId('drawing'), zIndex: state.maxZ + 1 }, 4, Math.abs(state.clipboard.points[0]?.price ?? 1) * 0.01)
        actions.commit([...state.drawings, clone])
        setSelectedDrawingId(clone.id)
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        const keyMap: Record<string, DrawingTool> = { h: 'horizontalLine', v: 'verticalLine', t: 'trendLine', r: 'rectangle' }
        const next = keyMap[event.key.toLowerCase()]
        if (next) {
          event.preventDefault()
          setActiveTool(next)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const capturePointerEvents = !disabled && (
    activeTool === 'select'
    || activeTool === 'eraser'
    || isDrawingType(activeTool)
    || Boolean(draft)
    || Boolean(dragState)
  )

  const draftDrawing = draft
    ? ({
        id: 'draft',
        type: draft.type,
        name: 'Draft',
        symbol,
        timeframe,
        paneId: 'price',
        points: draft.preview ? [...draft.points, draft.preview] : draft.points,
        style: defaultStyleForTool(draft.type),
        visible: true,
        locked: true,
        zIndex: maxZ + 2,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies ChartDrawing)
    : null

  return (
    <div className="chart-drawing-workspace">
      <DrawingToolbar
        activeTool={activeTool}
        magnetMode={magnetMode}
        keepDrawing={keepDrawing}
        lockedAll={lockedAll}
        drawingsHidden={drawingsHidden}
        indicatorsHidden={indicatorsHidden}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        selectedDrawingId={selectedDrawingId}
        favoriteTools={favoriteTools}
        onToolChange={setActiveTool}
        onMagnetChange={setMagnetMode}
        onKeepDrawingChange={setKeepDrawing}
        onLockedAllChange={setLockedAll}
        onDrawingsHiddenChange={setDrawingsHidden}
        onIndicatorsHiddenChange={onIndicatorsHiddenChange}
        onUndo={undo}
        onRedo={redo}
        onDeleteSelected={() => selectedDrawingId && deleteDrawing(selectedDrawingId)}
        onRemoveAll={removeAllDrawings}
        onExport={exportDrawings}
        onImport={importDrawings}
        onOpenManager={() => setManagerOpen(true)}
        onToggleFavorite={toggleFavorite}
      />

      {favoriteTools.length > 0 && (
        <div className="favorite-drawing-tools">
          {favoriteTools.map((tool) => {
            const definition = DRAWING_TOOL_MAP.get(tool)
            return (
              <button
                type="button"
                className={activeTool === tool ? 'active' : ''}
                key={tool}
                onClick={() => setActiveTool(tool)}
              >
                {definition?.label ?? tool}
              </button>
            )
          })}
        </div>
      )}

      {selectedDrawing && (
        <DrawingStyleToolbar
          drawing={selectedDrawing}
          onStyleChange={updateStyle}
          onToggleLock={() => replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, locked: !drawing.locked, updatedAt: Date.now() }))}
          onToggleVisible={() => replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, visible: !drawing.visible, updatedAt: Date.now() }))}
          onClone={cloneSelected}
          onDelete={() => deleteDrawing(selectedDrawing.id)}
        />
      )}

      {managerOpen && (
        <DrawingManager
          drawings={drawings}
          selectedDrawingId={selectedDrawingId}
          onSelect={setSelectedDrawingId}
          onRename={(id, name) => replaceDrawing(id, (drawing) => ({ ...drawing, name, updatedAt: Date.now() }), false)}
          onToggleVisible={(id) => replaceDrawing(id, (drawing) => ({ ...drawing, visible: !drawing.visible, updatedAt: Date.now() }))}
          onToggleLock={(id) => replaceDrawing(id, (drawing) => ({ ...drawing, locked: !drawing.locked, updatedAt: Date.now() }))}
          onDelete={deleteDrawing}
          onReorder={(id, direction) => replaceDrawing(id, (drawing) => ({ ...drawing, zIndex: drawing.zIndex + direction, updatedAt: Date.now() }))}
          onClose={() => setManagerOpen(false)}
        />
      )}

      {editingTextId && renderTextEditor()}

      <svg
        ref={svgRef}
        className={`drawing-svg-layer${capturePointerEvents ? ' drawing-capturing' : ''}`}
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${Math.max(svgWidth, 1)} ${Math.max(svgHeight, 1)}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onContextMenu={handleContextMenu}
      >
        <defs>
          <marker id={`arrow-${panelId}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        {capturePointerEvents && <rect className="drawing-event-capture" width="100%" height="100%" />}
        {!drawingsHidden && [...drawings]
          .filter((drawing) => drawing.visible)
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((drawing) => renderDrawing(drawing))}
        {draftDrawing && renderDrawing(draftDrawing, true)}
      </svg>

      {contextMenu && (
        <DrawingContextMenu
          state={contextMenu}
          drawing={drawings.find((drawing) => drawing.id === contextMenu.drawingId) ?? null}
          onClose={() => setContextMenu(null)}
          onClone={() => {
            cloneSelected()
            setContextMenu(null)
          }}
          onCopy={() => {
            if (selectedDrawing) setClipboard(cloneDrawing(selectedDrawing))
            setContextMenu(null)
          }}
          onToggleLock={() => {
            if (selectedDrawing) replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, locked: !drawing.locked, updatedAt: Date.now() }))
            setContextMenu(null)
          }}
          onToggleVisible={() => {
            if (selectedDrawing) replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, visible: !drawing.visible, updatedAt: Date.now() }))
            setContextMenu(null)
          }}
          onBringToFront={() => {
            if (selectedDrawing) replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, zIndex: maxZ + 1, updatedAt: Date.now() }))
            setContextMenu(null)
          }}
          onSendToBack={() => {
            if (selectedDrawing) replaceDrawing(selectedDrawing.id, (drawing) => ({ ...drawing, zIndex: 0, updatedAt: Date.now() }))
            setContextMenu(null)
          }}
          onDelete={() => {
            if (selectedDrawing) deleteDrawing(selectedDrawing.id)
            setContextMenu(null)
          }}
          onResetChart={() => {
            onResetChart()
            setContextMenu(null)
          }}
          onRemoveDrawings={() => {
            removeAllDrawings()
            setContextMenu(null)
          }}
          onHideDrawings={() => {
            setDrawingsHidden(true)
            setContextMenu(null)
          }}
        />
      )}
    </div>
  )

  function renderTextEditor() {
    const drawing = drawings.find((item) => item.id === editingTextId)
    const anchorPoint = drawing?.points.at(-1) ?? drawing?.points[0]
    const anchor = anchorPoint ? project(anchorPoint) : null
    if (!drawing || !anchor) return null
    return (
      <input
        className="drawing-text-editor"
        autoFocus
        value={drawing.style.text}
        style={{ left: anchor.x + 8, top: anchor.y - 32 }}
        onChange={(event) => replaceDrawing(drawing.id, (current) => ({
          ...current,
          style: { ...current.style, text: event.target.value },
          updatedAt: Date.now(),
        }), false)}
        onBlur={() => setEditingTextId(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            setEditingTextId(null)
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
    )
  }

  function renderDrawing(drawing: ChartDrawing, isDraft = false) {
    const points = drawing.points.map(project)
    if (points.some((point) => !point)) return null
    const projected = points as ScreenPoint[]
    const selected = drawing.id === selectedDrawingId && !isDraft
    const common = {
      stroke: drawing.style.color,
      strokeWidth: drawing.style.lineWidth,
      strokeDasharray: lineDash(drawing.style),
      opacity: isDraft ? 0.65 : drawing.style.opacity,
      fill: 'none',
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
      vectorEffect: 'non-scaling-stroke' as const,
    }
    const groupProps = isDraft ? {} : {
      onPointerDown: (event: PointerEvent<SVGGElement>) => handleDrawingPointerDown(event, drawing.id),
      onContextMenu: (event: PointerEvent<SVGGElement>) => handleDrawingContextMenu(event, drawing.id),
    }
    return (
      <g
        className={`drawing-object${selected ? ' selected' : ''}${drawing.locked || lockedAll ? ' locked' : ''}`}
        key={drawing.id}
        style={{ color: drawing.style.color, pointerEvents: isDraft ? 'none' : 'auto' }}
        {...groupProps}
      >
        {renderDrawingShape(drawing, projected, common)}
        {selected && renderHandles(drawing, projected)}
      </g>
    )
  }

  function renderDrawingShape(drawing: ChartDrawing, points: ScreenPoint[], common: Record<string, unknown>) {
    const [a, b, c, d] = points
    const fill = drawing.style.showFill ? drawing.style.fillColor : 'none'
    const fillOpacity = drawing.style.showFill ? drawing.style.fillOpacity : 0

    if (drawing.type === 'horizontalLine' && a) {
      return <line x1={0} y1={a.y} x2={svgWidth} y2={a.y} {...common} />
    }
    if (drawing.type === 'horizontalRay' && a) {
      return <line x1={a.x} y1={a.y} x2={svgWidth} y2={a.y} {...common} />
    }
    if (drawing.type === 'verticalLine' && a) {
      return <line x1={a.x} y1={0} x2={a.x} y2={svgHeight} {...common} />
    }
    if ((drawing.type === 'trendLine' || drawing.type === 'arrow') && a && b) {
      return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd={drawing.type === 'arrow' ? `url(#arrow-${panelId})` : undefined} {...common} />
    }
    if ((drawing.type === 'ray' || drawing.type === 'extendedLine') && a && b) {
      const line = extendLine(a, b, drawing.type === 'ray')
      return <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} {...common} />
    }
    if ((drawing.type === 'rectangle' || drawing.type === 'priceChannel') && a && b) {
      return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={fill} fillOpacity={fillOpacity} {...common} />
    }
    if (drawing.type === 'ellipse' && a && b) {
      return <ellipse cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} fill={fill} fillOpacity={fillOpacity} {...common} />
    }
    if (drawing.type === 'triangle' && a && b && c) {
      return <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y}`} fill={fill} fillOpacity={fillOpacity} {...common} />
    }
    if (drawing.type === 'polyline' || drawing.type === 'brush') {
      return <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} {...common} />
    }
    if (drawing.type === 'parallelChannel' && a && b && c) {
      const offset = { x: c.x - a.x, y: c.y - a.y }
      return (
        <>
          <polygon points={`${a.x},${a.y} ${b.x},${b.y} ${b.x + offset.x},${b.y + offset.y} ${a.x + offset.x},${a.y + offset.y}`} fill={fill} fillOpacity={fillOpacity} stroke="none" />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          <line x1={a.x + offset.x} y1={a.y + offset.y} x2={b.x + offset.x} y2={b.y + offset.y} {...common} />
        </>
      )
    }
    if (drawing.type === 'fibonacci' && a && b) {
      const minX = Math.min(a.x, b.x)
      const maxX = Math.max(a.x, b.x)
      return (
        <>
          {drawing.style.showFill && <rect x={minX} y={Math.min(a.y, b.y)} width={maxX - minX} height={Math.abs(b.y - a.y)} fill={drawing.style.fillColor} fillOpacity={drawing.style.fillOpacity} stroke="none" />}
          {drawing.style.levels.filter((level) => level.visible).map((level) => {
            const y = a.y + (b.y - a.y) * level.value
            const price = drawing.points[0].price + (drawing.points[1].price - drawing.points[0].price) * level.value
            return (
              <g key={level.value}>
                <line x1={minX} y1={y} x2={maxX} y2={y} {...common} stroke={level.color ?? drawing.style.color} />
                <text x={maxX + 5} y={y - 3} className="drawing-label" fill={drawing.style.textColor}>
                  {(level.value * 100).toFixed(1)}% {formatNumber(price)}
                </text>
              </g>
            )
          })}
        </>
      )
    }
    if (drawing.type === 'text' || drawing.type === 'note' || drawing.type === 'priceLabel') {
      const label = drawing.type === 'priceLabel' ? `${drawing.style.text} ${formatNumber(drawing.points[0].price)}` : drawing.style.text
      return (
        <text
          x={a.x + 6}
          y={a.y - 6}
          className="drawing-text"
          fill={drawing.style.textColor}
          fontSize={drawing.style.fontSize}
          fontWeight={drawing.style.bold ? 700 : 500}
          fontStyle={drawing.style.italic ? 'italic' : 'normal'}
        >
          {label}
        </text>
      )
    }
    if (drawing.type === 'callout' && a && b) {
      return (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          <text x={b.x + 7} y={b.y - 7} className="drawing-text" fill={drawing.style.textColor} fontSize={drawing.style.fontSize}>
            {drawing.style.text}
          </text>
        </>
      )
    }
    if ((drawing.type === 'priceRange' || drawing.type === 'dateRange' || drawing.type === 'datePriceRange') && a && b) {
      const priceDelta = drawing.points[1].price - drawing.points[0].price
      const percent = drawing.points[0].price === 0 ? 0 : priceDelta / drawing.points[0].price * 100
      const bars = Math.abs(nearestTimestampIndex(timestamps, drawing.points[1].timestamp) - nearestTimestampIndex(timestamps, drawing.points[0].timestamp))
      const label = drawing.type === 'priceRange'
        ? `${priceDelta >= 0 ? '+' : ''}${formatNumber(priceDelta)} (${percent.toFixed(2)}%)`
        : drawing.type === 'dateRange'
          ? `${bars} bars / ${daysBetween(drawing.points[0].timestamp, drawing.points[1].timestamp)} days`
          : `${priceDelta >= 0 ? '+' : ''}${formatNumber(priceDelta)} (${percent.toFixed(2)}%) / ${bars} bars`
      return (
        <>
          <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={drawing.style.fillColor} fillOpacity={drawing.style.fillOpacity} {...common} />
          <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6} className="drawing-label" fill={drawing.style.textColor}>{label}</text>
        </>
      )
    }
    if ((drawing.type === 'longPosition' || drawing.type === 'shortPosition') && a && b && c && d) {
      const x1 = Math.min(a.x, b.x)
      const x2 = Math.max(a.x, b.x)
      const entryY = a.y
      const targetY = c.y
      const stopY = d.y
      const risk = Math.abs(drawing.points[0].price - drawing.points[3].price)
      const reward = Math.abs(drawing.points[2].price - drawing.points[0].price)
      return (
        <>
          <rect x={x1} y={Math.min(entryY, targetY)} width={Math.max(x2 - x1, 120)} height={Math.abs(targetY - entryY)} fill="#22c55e" fillOpacity={0.2} stroke="#22c55e" strokeOpacity={0.75} />
          <rect x={x1} y={Math.min(entryY, stopY)} width={Math.max(x2 - x1, 120)} height={Math.abs(stopY - entryY)} fill="#ef4444" fillOpacity={0.18} stroke="#ef4444" strokeOpacity={0.75} />
          <line x1={x1} y1={entryY} x2={Math.max(x2, x1 + 120)} y2={entryY} {...common} />
          <text x={x1 + 8} y={Math.min(entryY, targetY) + 16} className="drawing-label" fill="#bbf7d0">TAKE PROFIT {formatNumber(drawing.points[2].price)}</text>
          <text x={x1 + 8} y={entryY - 6} className="drawing-label" fill={drawing.style.textColor}>ENTRY {formatNumber(drawing.points[0].price)}</text>
          <text x={x1 + 8} y={Math.max(entryY, stopY) - 8} className="drawing-label" fill="#fecaca">STOP LOSS {formatNumber(drawing.points[3].price)}</text>
          <text x={Math.max(x2, x1 + 120) + 8} y={entryY - 6} className="drawing-label" fill={drawing.style.textColor}>R/R {(reward / Math.max(risk, 0.000001)).toFixed(2)}</text>
        </>
      )
    }
    return null
  }

  function renderHandles(drawing: ChartDrawing, points: ScreenPoint[]) {
    if (drawing.locked || lockedAll) return null
    return (
      <g className="drawing-handles">
        {points.map((point, index) => (
          <circle
            key={`${drawing.id}-${index}`}
            cx={point.x}
            cy={point.y}
            r={5}
            onPointerDown={(event) => startDrag(event, drawing.id, 'point', index)}
          />
        ))}
      </g>
    )
  }

  function extendLine(a: ScreenPoint, b: ScreenPoint, rayOnly: boolean) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (Math.abs(dx) < 0.001) {
      return rayOnly
        ? { x1: a.x, y1: a.y, x2: b.x, y2: dy >= 0 ? svgHeight : 0 }
        : { x1: a.x, y1: 0, x2: a.x, y2: svgHeight }
    }
    const slope = dy / dx
    const yAtLeft = a.y + (0 - a.x) * slope
    const yAtRight = a.y + (svgWidth - a.x) * slope
    if (!rayOnly) return { x1: 0, y1: yAtLeft, x2: svgWidth, y2: yAtRight }
    return b.x >= a.x
      ? { x1: a.x, y1: a.y, x2: svgWidth, y2: yAtRight }
      : { x1: a.x, y1: a.y, x2: 0, y2: yAtLeft }
  }
}
