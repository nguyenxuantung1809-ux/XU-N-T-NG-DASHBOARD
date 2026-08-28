import { Copy, Eye, EyeOff, Lock, LockOpen, Palette, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ChartDrawing, DrawingLineStyle, DrawingStyle } from '../../types/drawings'

interface DrawingStyleToolbarProps {
  drawing: ChartDrawing
  onStyleChange: (patch: Partial<DrawingStyle>) => void
  onToggleLock: () => void
  onToggleVisible: () => void
  onClone: () => void
  onDelete: () => void
}

const BASIC_DRAWING_COLORS = [
  '#ffffff',
  '#94a3b8',
  '#111827',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
]

function BasicColorPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}) {
  const normalizedValue = value.toLowerCase()
  return (
    <div className="drawing-basic-color-picker" title={`${label} color`}>
      <span>{label}</span>
      <div className="drawing-basic-swatches">
        {BASIC_DRAWING_COLORS.map((color) => (
          <button
            type="button"
            className={normalizedValue === color ? 'active' : ''}
            key={color}
            style={{ backgroundColor: color }}
            title={color}
            aria-label={`${label} ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  )
}

export function DrawingStyleToolbar({
  drawing,
  onStyleChange,
  onToggleLock,
  onToggleVisible,
  onClone,
  onDelete,
}: DrawingStyleToolbarProps) {
  const [advancedColorOpen, setAdvancedColorOpen] = useState(false)

  return (
    <div className="drawing-style-toolbar">
      <BasicColorPicker label="Color" value={drawing.style.color} onChange={(color) => onStyleChange({ color })} />
      <BasicColorPicker label="Fill" value={drawing.style.fillColor} onChange={(fillColor) => onStyleChange({ fillColor })} />
      <button
        type="button"
        className={advancedColorOpen ? 'active' : ''}
        title="Advanced color picker"
        onClick={() => setAdvancedColorOpen((open) => !open)}
      >
        <Palette size={15} />
      </button>
      {advancedColorOpen && (
        <>
          <label title="Advanced line color">
            <span>Color</span>
            <input type="color" value={drawing.style.color} onChange={(event) => onStyleChange({ color: event.target.value })} />
          </label>
          <label title="Advanced fill color">
            <span>Fill</span>
            <input type="color" value={drawing.style.fillColor} onChange={(event) => onStyleChange({ fillColor: event.target.value })} />
          </label>
        </>
      )}
      <label title="Line width">
        <span>Width</span>
        <input
          type="number"
          min={1}
          max={8}
          value={drawing.style.lineWidth}
          onChange={(event) => onStyleChange({ lineWidth: Math.min(Math.max(Number(event.target.value) || 1, 1), 8) })}
        />
      </label>
      <label title="Line style">
        <span>Style</span>
        <select value={drawing.style.lineStyle} onChange={(event) => onStyleChange({ lineStyle: event.target.value as DrawingLineStyle })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      <label title="Opacity">
        <span>Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={drawing.style.opacity}
          onChange={(event) => onStyleChange({ opacity: Number(event.target.value) })}
        />
      </label>
      {(drawing.type === 'text' || drawing.type === 'note' || drawing.type === 'callout' || drawing.type === 'priceLabel') && (
        <>
          <label title="Font size">
            <span>Font</span>
            <input
              type="number"
              min={9}
              max={34}
              value={drawing.style.fontSize}
              onChange={(event) => onStyleChange({ fontSize: Math.min(Math.max(Number(event.target.value) || 13, 9), 34) })}
            />
          </label>
          <label className="text-field" title="Text">
            <span>Text</span>
            <input value={drawing.style.text} onChange={(event) => onStyleChange({ text: event.target.value })} />
          </label>
        </>
      )}
      <button type="button" className={drawing.locked ? 'active' : ''} title={drawing.locked ? 'Unlock' : 'Lock'} onClick={onToggleLock}>
        {drawing.locked ? <Lock size={15} /> : <LockOpen size={15} />}
      </button>
      <button type="button" className={!drawing.visible ? 'active' : ''} title={drawing.visible ? 'Hide' : 'Show'} onClick={onToggleVisible}>
        {drawing.visible ? <Eye size={15} /> : <EyeOff size={15} />}
      </button>
      <button type="button" title="Clone" onClick={onClone}><Copy size={15} /></button>
      <button type="button" title="Delete" onClick={onDelete}><Trash2 size={15} /></button>
    </div>
  )
}
