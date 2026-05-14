import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { useStore } from '../store'
import { clsx } from 'clsx'

interface HighlightPickerProps {
  onClose: () => void
}

export default function HighlightPicker({ onClose }: HighlightPickerProps) {
  const { highlightTypes, activeHighlightTypeId, setActiveHighlightTypeId } = useStore()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 z-50 bg-ink border border-white/10 rounded-xl shadow-2xl p-2 min-w-48"
    >
      {highlightTypes.map((type) => (
        <button
          key={type.id}
          onClick={() => {
            setActiveHighlightTypeId(type.id)
            onClose()
          }}
          className={clsx(
            'flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-sm transition-colors',
            activeHighlightTypeId === type.id
              ? 'bg-white/5 text-blush'
              : 'text-lavender/70 hover:bg-white/5 hover:text-blush'
          )}
        >
          <span
            className="w-4 h-4 rounded-full shrink-0"
            style={{ backgroundColor: type.color }}
          />
          <span className="flex-1">{type.name}</span>
          {activeHighlightTypeId === type.id && <Check size={12} className="text-ocean" />}
        </button>
      ))}
    </div>
  )
}
