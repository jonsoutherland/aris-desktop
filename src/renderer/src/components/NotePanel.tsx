import { useState, useEffect } from 'react'
import { X, Check } from 'lucide-react'

interface NotePanelProps {
  initialTerm?: string
  initialDefinition?: string
  onSave: (term: string, definition: string) => void
  onClose: () => void
}

export default function NotePanel({ initialTerm = '', initialDefinition = '', onSave, onClose }: NotePanelProps) {
  const [term, setTerm] = useState(initialTerm)
  const [definition, setDefinition] = useState(initialDefinition)

  useEffect(() => {
    setTerm(initialTerm)
    setDefinition(initialDefinition)
  }, [initialTerm, initialDefinition])

  const handleSave = () => {
    const t = term.trim()
    const d = definition.trim()
    if (!t || !d) return
    onSave(t, d)
  }

  return (
    <div className="w-72 shrink-0 flex flex-col bg-ink border-l border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h3 className="font-serif text-base text-blush">New Note</h3>
        <button onClick={onClose} className="text-lavender/40 hover:text-lavender transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-4">
        <div>
          <label className="text-xs text-sage font-medium block mb-1.5">Term</label>
          <textarea
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Key term or concept…"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-blush outline-none focus:border-ocean/50 resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-lavender/60 font-medium block mb-1.5">Definition / Notes</label>
          <textarea
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            placeholder="Explanation, context, or notes…"
            rows={5}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-blush outline-none focus:border-ocean/50 resize-none"
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!term.trim() || !definition.trim()}
          className="flex items-center justify-center gap-2 w-full bg-ocean text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ocean/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-auto"
        >
          <Check size={14} />
          Save Note
        </button>
      </div>
    </div>
  )
}
