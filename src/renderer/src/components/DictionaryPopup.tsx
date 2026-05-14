import { useState, useEffect, useRef } from 'react'
import { X, BookOpen, Volume2, Loader2, Plus, Check } from 'lucide-react'

interface Definition {
  definition: string
  example?: string
}

interface Meaning {
  partOfSpeech: string
  definitions: Definition[]
  synonyms: string[]
}

interface DictEntry {
  word: string
  phonetic?: string
  meanings: Meaning[]
}

interface Props {
  word: string
  // Viewport-relative coordinates of the word's bounding box
  anchorX: number
  anchorTop: number    // top of the word rect
  anchorBottom: number // bottom of the word rect
  onClose: () => void
  onAddVocab?: (word: string, definition: string) => void
}

type Status = 'loading' | 'found' | 'notfound' | 'error'

const POS_COLORS: Record<string, string> = {
  noun: 'bg-ocean/20 text-ocean',
  verb: 'bg-sage/20 text-sage',
  adjective: 'bg-lavender/20 text-lavender',
  adverb: 'bg-amber-500/20 text-amber-400',
  pronoun: 'bg-pink-500/20 text-pink-400',
  preposition: 'bg-purple-500/20 text-purple-400',
  conjunction: 'bg-teal-500/20 text-teal-400',
  interjection: 'bg-orange-500/20 text-orange-400',
}

function posClass(pos: string) {
  return POS_COLORS[pos.toLowerCase()] ?? 'bg-white/10 text-lavender'
}

export default function DictionaryPopup({ word, anchorX, anchorTop, anchorBottom, onClose, onAddVocab }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [entry, setEntry] = useState<DictEntry | null>(null)
  const [vocabAdded, setVocabAdded] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  // Fetch definition
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setEntry(null)

    const clean = word.toLowerCase().replace(/[^a-z'-]/g, '')
    if (!clean) { setStatus('notfound'); return }

    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`)
      .then((r) => {
        if (!r.ok) throw Object.assign(new Error(), { status: r.status })
        return r.json()
      })
      .then((data: DictEntry[]) => {
        if (cancelled) return
        if (!data?.length) { setStatus('notfound'); return }
        setEntry(data[0])
        setStatus('found')
      })
      .catch((err) => {
        if (cancelled) return
        setStatus(err?.status === 404 ? 'notfound' : 'error')
      })

    return () => { cancelled = true }
  }, [word])

  // Position — prefer above the word; fall back below if too close to top
  const POPUP_H_ESTIMATE = 280
  const MARGIN = 8
  const popupWidth = 300

  const showAbove = anchorTop - POPUP_H_ESTIMATE - MARGIN > 0
  const top = showAbove
    ? anchorTop - POPUP_H_ESTIMATE - MARGIN
    : anchorBottom + MARGIN

  // Clamp horizontally so popup doesn't overflow viewport
  const left = Math.max(
    MARGIN,
    Math.min(anchorX - popupWidth / 2, window.innerWidth - popupWidth - MARGIN)
  )

  return (
    <div
      ref={popupRef}
      className="fixed z-[500] bg-[#1e2535] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
      style={{ width: popupWidth, top, left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-3.5 pb-2 border-b border-white/5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={13} className="text-ocean shrink-0" />
            <span className="text-base font-serif font-bold text-blush truncate">{word}</span>
          </div>
          {entry?.phonetic && (
            <div className="flex items-center gap-1 mt-0.5">
              <Volume2 size={10} className="text-lavender/40" />
              <span className="text-[11px] text-lavender/50 font-mono">{entry.phonetic}</span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-2 mt-0.5 text-lavender/40 hover:text-lavender transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-56 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {status === 'loading' && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={20} className="text-ocean/60 animate-spin" />
          </div>
        )}

        {status === 'notfound' && (
          <p className="text-xs text-lavender/50 text-center py-4">
            No definition found for &ldquo;{word}&rdquo;.
          </p>
        )}

        {status === 'error' && (
          <p className="text-xs text-lavender/50 text-center py-4">
            Dictionary unavailable. Check your connection.
          </p>
        )}

        {status === 'found' && entry && entry.meanings.slice(0, 4).map((m, mi) => (
          <div key={mi}>
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mb-2 ${posClass(m.partOfSpeech)}`}>
              {m.partOfSpeech}
            </span>
            <ol className="flex flex-col gap-2">
              {m.definitions.slice(0, 3).map((d, di) => (
                <li key={di} className="flex gap-2">
                  {m.definitions.length > 1 && (
                    <span className="text-[10px] text-lavender/30 mt-0.5 shrink-0 w-3">{di + 1}.</span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-blush/90 leading-relaxed">{d.definition}</p>
                    {d.example && (
                      <p className="text-[11px] text-lavender/50 italic mt-0.5 leading-relaxed">
                        &ldquo;{d.example}&rdquo;
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {m.synonyms.length > 0 && mi === 0 && (
              <p className="text-[10px] text-lavender/40 mt-2">
                <span className="text-lavender/60">Synonyms: </span>
                {m.synonyms.slice(0, 5).join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Footer — add to vocab */}
      {onAddVocab && status === 'found' && entry && (
        <div className="px-4 py-2 border-t border-white/5">
          <button
            onClick={() => {
              if (vocabAdded) return
              const def = entry.meanings[0]?.definitions[0]?.definition ?? ''
              onAddVocab(word, def)
              setVocabAdded(true)
            }}
            className="flex items-center gap-1.5 text-xs transition-colors w-full"
            style={{ color: vocabAdded ? '#7fbeab' : '#aea3b0' }}
          >
            {vocabAdded ? <Check size={11} /> : <Plus size={11} />}
            {vocabAdded ? 'Added to Vocabulary' : 'Add as vocab word'}
          </button>
        </div>
      )}
    </div>
  )
}
