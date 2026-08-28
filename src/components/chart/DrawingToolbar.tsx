import {
  ArrowUpRight,
  Brush,
  Calendar,
  Circle,
  CircleDot,
  Copy,
  Crosshair,
  Download,
  Eraser,
  Eye,
  Focus,
  Layers3,
  Lock,
  Magnet,
  MousePointer2,
  MoveHorizontal,
  MoveVertical,
  PencilLine,
  RectangleHorizontal,
  Redo2,
  Ruler,
  ScanLine,
  StickyNote,
  Tag,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
  Undo2,
  Upload,
} from 'lucide-react'
import { useMemo, useRef, useState, type ComponentType } from 'react'
import type { DrawingTool, MagnetMode } from '../../types/drawings'
import { DRAWING_TOOLS } from './drawingRegistry'

interface DrawingToolbarProps {
  activeTool: DrawingTool
  magnetMode: MagnetMode
  keepDrawing: boolean
  lockedAll: boolean
  drawingsHidden: boolean
  indicatorsHidden: boolean
  canUndo: boolean
  canRedo: boolean
  selectedDrawingId: string | null
  favoriteTools: DrawingTool[]
  onToolChange: (tool: DrawingTool) => void
  onMagnetChange: (mode: MagnetMode) => void
  onKeepDrawingChange: (value: boolean) => void
  onLockedAllChange: (value: boolean) => void
  onDrawingsHiddenChange: (value: boolean) => void
  onIndicatorsHiddenChange: (value: boolean) => void
  onUndo: () => void
  onRedo: () => void
  onDeleteSelected: () => void
  onRemoveAll: () => void
  onExport: () => void
  onImport: (text: string) => void
  onOpenManager: () => void
  onToggleFavorite: (tool: DrawingTool) => void
}

const TOOL_ICONS: Partial<Record<DrawingTool, ComponentType<{ size?: number }>>> = {
  crosshair: Crosshair,
  dot: CircleDot,
  select: MousePointer2,
  eraser: Eraser,
  trendLine: TrendingUp,
  ray: ArrowUpRight,
  extendedLine: ScanLine,
  horizontalLine: MoveHorizontal,
  horizontalRay: MoveHorizontal,
  verticalLine: MoveVertical,
  parallelChannel: Copy,
  priceChannel: RectangleHorizontal,
  fibonacci: Focus,
  rectangle: RectangleHorizontal,
  ellipse: Circle,
  triangle: Triangle,
  polyline: PencilLine,
  brush: Brush,
  arrow: ArrowUpRight,
  text: Type,
  note: StickyNote,
  priceLabel: Tag,
  callout: StickyNote,
  priceRange: Ruler,
  dateRange: Calendar,
  datePriceRange: Ruler,
  longPosition: TrendingUp,
  shortPosition: TrendingUp,
}

const GROUP_LABELS = {
  cursor: 'Cursor',
  trend: 'Trend tools',
  fib: 'Fibonacci',
  shape: 'Shapes',
  annotation: 'Annotations',
  measure: 'Measure',
  position: 'Positions',
} as const

const GROUP_ORDER = ['cursor', 'trend', 'fib', 'shape', 'annotation', 'measure', 'position'] as const

export function DrawingToolbar({
  activeTool,
  magnetMode,
  keepDrawing,
  lockedAll,
  drawingsHidden,
  indicatorsHidden,
  canUndo,
  canRedo,
  selectedDrawingId,
  favoriteTools,
  onToolChange,
  onMagnetChange,
  onKeepDrawingChange,
  onLockedAllChange,
  onDrawingsHiddenChange,
  onIndicatorsHiddenChange,
  onUndo,
  onRedo,
  onDeleteSelected,
  onRemoveAll,
  onExport,
  onImport,
  onOpenManager,
  onToggleFavorite,
}: DrawingToolbarProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      tools: DRAWING_TOOLS.filter((tool) => tool.group === group),
    }))
  }, [])

  function readImportFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') onImport(reader.result)
      if (inputRef.current) inputRef.current.value = ''
    }
    reader.readAsText(file)
  }

  function cycleMagnet() {
    onMagnetChange(magnetMode === 'off' ? 'weak' : magnetMode === 'weak' ? 'strong' : 'off')
  }

  return (
    <div className="drawing-toolbar" aria-label="Drawing tools">
      {grouped.map(({ group, tools }) => {
        const activeInGroup = tools.find((tool) => tool.tool === activeTool) ?? tools[0]
        const Icon = TOOL_ICONS[activeInGroup.tool] ?? Crosshair
        return (
          <div className="drawing-tool-group" key={group}>
            <button
              type="button"
              className={tools.some((tool) => tool.tool === activeTool) ? 'active' : ''}
              title={GROUP_LABELS[group]}
              onClick={() => setOpenGroup((current) => current === group ? null : group)}
            >
              <Icon size={17} />
            </button>
            {openGroup === group && (
              <div className="drawing-tool-flyout">
                {tools.map((tool) => {
                  const ItemIcon = TOOL_ICONS[tool.tool] ?? Crosshair
                  const favorite = favoriteTools.includes(tool.tool)
                  return (
                    <button
                      type="button"
                      className={activeTool === tool.tool ? 'active' : ''}
                      key={tool.tool}
                      onClick={() => {
                        onToolChange(tool.tool)
                        setOpenGroup(null)
                      }}
                    >
                      <ItemIcon size={15} />
                      <span className="drawing-tool-label">{tool.label}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className={`favorite-dot${favorite ? ' active' : ''}`}
                        title={favorite ? 'Remove favorite' : 'Add favorite'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onToggleFavorite(tool.tool)
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          event.stopPropagation()
                          onToggleFavorite(tool.tool)
                        }}
                      />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <div className="drawing-toolbar-separator" />

      <button type="button" className={magnetMode !== 'off' ? 'active' : ''} title={`Magnet: ${magnetMode}`} onClick={cycleMagnet}>
        <Magnet size={16} />
      </button>
      <button type="button" className={keepDrawing ? 'active' : ''} title="Keep drawing" onClick={() => onKeepDrawingChange(!keepDrawing)}>
        <PencilLine size={16} />
      </button>
      <button type="button" className={lockedAll ? 'active' : ''} title="Lock all drawings" onClick={() => onLockedAllChange(!lockedAll)}>
        <Lock size={16} />
      </button>
      <button type="button" className={drawingsHidden ? 'active' : ''} title={drawingsHidden ? 'Show drawings' : 'Hide drawings'} onClick={() => onDrawingsHiddenChange(!drawingsHidden)}>
        <Eye size={16} />
      </button>
      <button type="button" className={indicatorsHidden ? 'active' : ''} title={indicatorsHidden ? 'Show indicators' : 'Hide indicators'} onClick={() => onIndicatorsHiddenChange(!indicatorsHidden)}>
        <ScanLine size={16} />
      </button>

      <div className="drawing-toolbar-separator" />

      <button type="button" title="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={16} /></button>
      <button type="button" title="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={16} /></button>
      <button type="button" title="Delete selected" disabled={!selectedDrawingId} onClick={onDeleteSelected}><Trash2 size={16} /></button>
      <button type="button" title="Layers" onClick={onOpenManager}><Layers3 size={16} /></button>
      <button type="button" title="Export drawings" onClick={onExport}><Download size={16} /></button>
      <button type="button" title="Import drawings" onClick={() => inputRef.current?.click()}><Upload size={16} /></button>
      <button type="button" title="Remove all drawings" onClick={onRemoveAll}><Trash2 size={16} /></button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        onChange={(event) => readImportFile(event.target.files?.[0])}
      />
    </div>
  )
}
