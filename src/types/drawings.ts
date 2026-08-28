export type CursorTool = 'crosshair' | 'dot' | 'select' | 'eraser'

export type DrawingTool =
  | CursorTool
  | 'trendLine'
  | 'ray'
  | 'extendedLine'
  | 'horizontalLine'
  | 'horizontalRay'
  | 'verticalLine'
  | 'parallelChannel'
  | 'priceChannel'
  | 'fibonacci'
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'polyline'
  | 'brush'
  | 'arrow'
  | 'text'
  | 'note'
  | 'priceLabel'
  | 'callout'
  | 'priceRange'
  | 'dateRange'
  | 'datePriceRange'
  | 'longPosition'
  | 'shortPosition'

export type DrawingType = Exclude<DrawingTool, CursorTool>
export type MagnetMode = 'off' | 'weak' | 'strong'
export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted'

export interface DrawingPoint {
  timestamp: string
  price: number
}

export interface FibLevel {
  value: number
  visible: boolean
  color?: string
}

export interface DrawingStyle {
  color: string
  fillColor: string
  textColor: string
  backgroundColor: string
  lineWidth: number
  lineStyle: DrawingLineStyle
  opacity: number
  fillOpacity: number
  fontSize: number
  bold: boolean
  italic: boolean
  showFill: boolean
  extendLeft: boolean
  extendRight: boolean
  text: string
  levels: FibLevel[]
}

export interface ChartDrawing {
  id: string
  type: DrawingType
  name: string
  symbol: string
  timeframe: string
  paneId: string
  points: DrawingPoint[]
  style: DrawingStyle
  visible: boolean
  locked: boolean
  zIndex: number
  createdAt: number
  updatedAt: number
}

export interface DrawingToolDefinition {
  tool: DrawingTool
  label: string
  group: 'cursor' | 'trend' | 'fib' | 'shape' | 'annotation' | 'measure' | 'position'
  minPoints: number
  continuous?: boolean
}

export interface DrawingExportPayload {
  version: 1
  exportedAt: number
  drawings: ChartDrawing[]
}
