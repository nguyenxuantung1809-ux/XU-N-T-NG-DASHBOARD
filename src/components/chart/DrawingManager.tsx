import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Trash2, X } from 'lucide-react'
import type { ChartDrawing } from '../../types/drawings'

interface DrawingManagerProps {
  drawings: ChartDrawing[]
  selectedDrawingId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, name: string) => void
  onToggleVisible: (id: string) => void
  onToggleLock: (id: string) => void
  onDelete: (id: string) => void
  onReorder: (id: string, direction: -1 | 1) => void
  onClose: () => void
}

export function DrawingManager({
  drawings,
  selectedDrawingId,
  onSelect,
  onRename,
  onToggleVisible,
  onToggleLock,
  onDelete,
  onReorder,
  onClose,
}: DrawingManagerProps) {
  return (
    <div className="drawing-manager">
      <div className="drawing-manager-header">
        <strong>Objects</strong>
        <button type="button" className="icon-button" title="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <div className="drawing-manager-list">
        {drawings.length === 0 && <div className="drawing-manager-empty">No drawings</div>}
        {[...drawings].sort((a, b) => b.zIndex - a.zIndex).map((drawing) => (
          <div className={`drawing-manager-row${drawing.id === selectedDrawingId ? ' active' : ''}`} key={drawing.id}>
            <button type="button" className="drawing-manager-select" onClick={() => onSelect(drawing.id)}>
              <span>{drawing.type}</span>
              <input
                value={drawing.name}
                onChange={(event) => onRename(drawing.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
            </button>
            <button type="button" className="icon-button" title={drawing.visible ? 'Hide' : 'Show'} onClick={() => onToggleVisible(drawing.id)}>
              {drawing.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button type="button" className="icon-button" title={drawing.locked ? 'Unlock' : 'Lock'} onClick={() => onToggleLock(drawing.id)}>
              {drawing.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button type="button" className="icon-button" title="Bring forward" onClick={() => onReorder(drawing.id, 1)}><ArrowUp size={14} /></button>
            <button type="button" className="icon-button" title="Send backward" onClick={() => onReorder(drawing.id, -1)}><ArrowDown size={14} /></button>
            <button type="button" className="icon-button danger" title="Delete" onClick={() => onDelete(drawing.id)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
