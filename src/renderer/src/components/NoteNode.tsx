import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'

type NoteData = {
  label: string
  color: string
  animating: boolean
}

function NoteNode({ data, selected }: NodeProps) {
  const d = data as NoteData
  const cls = [
    'note-node-inner',
    selected ? 'note-node-selected' : '',
    d.animating ? 'note-node-glowing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cls}
      style={
        {
          '--node-color': d.color,
          border: `1.5px solid ${d.color}`,
        } as React.CSSProperties
      }
    >
      {/* Invisible full-coverage target — connectionRadius handles the snap zone */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="target"
        className="note-handle-target"
      />
      {/* Visible source dot */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="source"
        className="note-handle"
      />
      <span className="note-node-label">{d.label}</span>
    </div>
  )
}

export default memo(NoteNode)
