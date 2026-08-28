import type { ChartDrawing } from '../../types/drawings'

export interface DrawingContextMenuState {
  x: number
  y: number
  drawingId: string | null
}

interface DrawingContextMenuProps {
  state: DrawingContextMenuState
  drawing: ChartDrawing | null
  onClose: () => void
  onClone: () => void
  onCopy: () => void
  onToggleLock: () => void
  onToggleVisible: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onDelete: () => void
  onResetChart: () => void
  onRemoveDrawings: () => void
  onHideDrawings: () => void
}

export function DrawingContextMenu({
  state,
  drawing,
  onClose,
  onClone,
  onCopy,
  onToggleLock,
  onToggleVisible,
  onBringToFront,
  onSendToBack,
  onDelete,
  onResetChart,
  onRemoveDrawings,
  onHideDrawings,
}: DrawingContextMenuProps) {
  return (
    <div
      className="drawing-context-menu"
      style={{ left: state.x, top: state.y }}
      onMouseLeave={onClose}
    >
      {drawing ? (
        <>
          <button type="button" onClick={onClone}>Clone</button>
          <button type="button" onClick={onCopy}>Copy</button>
          <button type="button" onClick={onToggleLock}>{drawing.locked ? 'Unlock' : 'Lock'}</button>
          <button type="button" onClick={onToggleVisible}>{drawing.visible ? 'Hide' : 'Show'}</button>
          <button type="button" onClick={onBringToFront}>Bring to front</button>
          <button type="button" onClick={onSendToBack}>Send to back</button>
          <button type="button" className="danger" onClick={onDelete}>Delete</button>
        </>
      ) : (
        <>
          <button type="button" onClick={onResetChart}>Reset chart</button>
          <button type="button" onClick={onRemoveDrawings}>Remove drawings</button>
          <button type="button" onClick={onHideDrawings}>Hide drawings</button>
          <button type="button" onClick={onClose}>Chart settings</button>
        </>
      )}
    </div>
  )
}
