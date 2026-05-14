import { Minus, Square, X } from 'lucide-react'
import { useStore } from '../store'

export default function TitleBar() {
  const { activeSourceId, sources } = useStore()
  const source = sources.find((s) => s.id === activeSourceId)

  return (
    <div
      className="flex items-center justify-between h-10 bg-ink border-b border-white/5 shrink-0 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 px-4">
        <span className="font-serif font-bold text-ocean text-sm tracking-widest">ARIS</span>
        {source && (
          <>
            <span className="text-lavender/40 text-xs">·</span>
            <span className="text-lavender text-xs truncate max-w-xs">{source.title}</span>
          </>
        )}
      </div>

      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => window.api.window.minimize()}
          className="w-10 h-10 flex items-center justify-center text-lavender/40 hover:text-lavender hover:bg-white/5 transition-colors"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => window.api.window.maximize()}
          className="w-10 h-10 flex items-center justify-center text-lavender/40 hover:text-lavender hover:bg-white/5 transition-colors"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => window.api.window.close()}
          className="w-10 h-10 flex items-center justify-center text-lavender/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
