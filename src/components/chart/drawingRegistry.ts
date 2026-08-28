import type { DrawingStyle, DrawingTool, DrawingToolDefinition, DrawingType, FibLevel } from '../../types/drawings'

export const DEFAULT_FIB_LEVELS: FibLevel[] = [
  { value: 0, visible: true },
  { value: 0.236, visible: true },
  { value: 0.382, visible: true },
  { value: 0.5, visible: true },
  { value: 0.618, visible: true },
  { value: 0.786, visible: true },
  { value: 1, visible: true },
]

export const DEFAULT_DRAWING_STYLE: DrawingStyle = {
  color: '#38bdf8',
  fillColor: '#38bdf8',
  textColor: '#e5edf7',
  backgroundColor: '#0f172a',
  lineWidth: 2,
  lineStyle: 'solid',
  opacity: 0.95,
  fillOpacity: 0.16,
  fontSize: 13,
  bold: false,
  italic: false,
  showFill: true,
  extendLeft: false,
  extendRight: false,
  text: '',
  levels: DEFAULT_FIB_LEVELS,
}

export const DRAWING_TOOLS: DrawingToolDefinition[] = [
  { tool: 'crosshair', label: 'Crosshair', group: 'cursor', minPoints: 0 },
  { tool: 'dot', label: 'Dot cursor', group: 'cursor', minPoints: 0 },
  { tool: 'select', label: 'Select', group: 'cursor', minPoints: 0 },
  { tool: 'eraser', label: 'Eraser', group: 'cursor', minPoints: 0 },
  { tool: 'trendLine', label: 'Trend Line', group: 'trend', minPoints: 2 },
  { tool: 'ray', label: 'Ray', group: 'trend', minPoints: 2 },
  { tool: 'extendedLine', label: 'Extended Line', group: 'trend', minPoints: 2 },
  { tool: 'horizontalLine', label: 'Horizontal Line', group: 'trend', minPoints: 1 },
  { tool: 'horizontalRay', label: 'Horizontal Ray', group: 'trend', minPoints: 1 },
  { tool: 'verticalLine', label: 'Vertical Line', group: 'trend', minPoints: 1 },
  { tool: 'parallelChannel', label: 'Parallel Channel', group: 'trend', minPoints: 3 },
  { tool: 'priceChannel', label: 'Price Channel', group: 'trend', minPoints: 2 },
  { tool: 'fibonacci', label: 'Fib Retracement', group: 'fib', minPoints: 2 },
  { tool: 'rectangle', label: 'Rectangle', group: 'shape', minPoints: 2 },
  { tool: 'ellipse', label: 'Circle / Ellipse', group: 'shape', minPoints: 2 },
  { tool: 'triangle', label: 'Triangle', group: 'shape', minPoints: 3 },
  { tool: 'polyline', label: 'Polyline', group: 'shape', minPoints: 2, continuous: true },
  { tool: 'brush', label: 'Brush', group: 'shape', minPoints: 2, continuous: true },
  { tool: 'arrow', label: 'Arrow', group: 'shape', minPoints: 2 },
  { tool: 'text', label: 'Text', group: 'annotation', minPoints: 1 },
  { tool: 'note', label: 'Note', group: 'annotation', minPoints: 1 },
  { tool: 'priceLabel', label: 'Price Label', group: 'annotation', minPoints: 1 },
  { tool: 'callout', label: 'Callout', group: 'annotation', minPoints: 2 },
  { tool: 'priceRange', label: 'Price Range', group: 'measure', minPoints: 2 },
  { tool: 'dateRange', label: 'Date Range', group: 'measure', minPoints: 2 },
  { tool: 'datePriceRange', label: 'Date & Price Range', group: 'measure', minPoints: 2 },
  { tool: 'longPosition', label: 'Long Position', group: 'position', minPoints: 2 },
  { tool: 'shortPosition', label: 'Short Position', group: 'position', minPoints: 2 },
]

export const DRAWING_TOOL_MAP = new Map(DRAWING_TOOLS.map((tool) => [tool.tool, tool]))

export function isDrawingType(tool: DrawingTool): tool is DrawingType {
  return !['crosshair', 'dot', 'select', 'eraser'].includes(tool)
}

export function getDefaultStyle(type: DrawingType): DrawingStyle {
  const style = { ...DEFAULT_DRAWING_STYLE, levels: DEFAULT_FIB_LEVELS.map((level) => ({ ...level })) }
  if (type === 'rectangle' || type === 'priceChannel') {
    style.fillColor = '#f59e0b'
    style.color = '#f59e0b'
  }
  if (type === 'fibonacci') {
    style.color = '#a78bfa'
    style.fillColor = '#a78bfa'
    style.fillOpacity = 0.08
  }
  if (type === 'longPosition') {
    style.color = '#22c55e'
    style.fillColor = '#22c55e'
    style.fillOpacity = 0.18
  }
  if (type === 'shortPosition') {
    style.color = '#f87171'
    style.fillColor = '#f87171'
    style.fillOpacity = 0.18
  }
  if (type === 'text' || type === 'note' || type === 'callout' || type === 'priceLabel') {
    style.color = '#f8fafc'
    style.fillColor = '#111827'
    style.text = type === 'priceLabel' ? 'Price' : type === 'note' ? 'Note' : 'Text'
    style.showFill = true
  }
  return style
}

export function getDrawingName(type: DrawingType, index: number) {
  return `${DRAWING_TOOL_MAP.get(type)?.label ?? type} ${index}`
}
