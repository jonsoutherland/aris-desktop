import { useState, useMemo } from 'react'
import { Brain, Check, X, RotateCcw, ChevronRight, BookOpen } from 'lucide-react'
import { useStore } from '../store'
import { clsx } from 'clsx'

type FlashcardMode = 'menu' | 'session' | 'done'

export default function Flashcards() {
  const { notes, flashcardStates, sources, recordFlashcardResult, activeSourceId } = useStore()
  const [mode, setMode] = useState<FlashcardMode>('menu')
  const [filterSourceId, setFilterSourceId] = useState<string | 'all'>('all')
  const [sessionCards, setSessionCards] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [sessionResults, setSessionResults] = useState<{ correct: number; incorrect: number }>({
    correct: 0,
    incorrect: 0,
  })

  const now = Date.now()

  const dueStates = useMemo(() => {
    return flashcardStates.filter((s) => {
      const note = notes.find((n) => n.id === s.note_id)
      if (!note) return false
      if (filterSourceId !== 'all' && note.source_id !== filterSourceId) return false
      return s.next_review <= now
    })
  }, [flashcardStates, notes, filterSourceId, now])

  const allStates = useMemo(() => {
    return flashcardStates.filter((s) => {
      const note = notes.find((n) => n.id === s.note_id)
      if (!note) return false
      if (filterSourceId !== 'all' && note.source_id !== filterSourceId) return false
      return true
    })
  }, [flashcardStates, notes, filterSourceId])

  const stageLabels: Record<number, string> = {
    0: 'New',
    1: '2-day',
    2: '7-day',
    3: '30-day',
  }
  const stageColors: Record<number, string> = {
    0: '#aea3b0',
    1: '#2978a0',
    2: '#7fbeab',
    3: '#e3d0d8',
  }

  const startSession = (onlyDue: boolean) => {
    const states = onlyDue ? dueStates : allStates
    const ids = states.map((s) => s.note_id).sort(() => Math.random() - 0.5)
    setSessionCards(ids)
    setCurrentIndex(0)
    setFlipped(false)
    setSessionResults({ correct: 0, incorrect: 0 })
    setMode('session')
  }

  const handleAnswer = async (correct: boolean) => {
    const noteId = sessionCards[currentIndex]
    await recordFlashcardResult(noteId, correct)
    setSessionResults((prev) => ({
      ...prev,
      [correct ? 'correct' : 'incorrect']: prev[correct ? 'correct' : 'incorrect'] + 1,
    }))

    const next = currentIndex + 1
    if (next >= sessionCards.length) {
      setMode('done')
    } else {
      setCurrentIndex(next)
      setFlipped(false)
    }
  }

  const currentNoteId = sessionCards[currentIndex]
  const currentNote = notes.find((n) => n.id === currentNoteId)
  const currentState = flashcardStates.find((s) => s.note_id === currentNoteId)

  // ── Menu view ──────────────────────────────────────────────────────────────

  if (mode === 'menu') {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="px-8 py-6 border-b border-white/5">
          <h1 className="font-serif text-2xl text-blush mb-1">Flashcards</h1>
          <p className="text-xs text-lavender/50">2-7-30 spaced repetition</p>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-xl mx-auto space-y-6">
            {/* Filter */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-lavender/50">Source:</span>
              <select
                value={filterSourceId}
                onChange={(e) => setFilterSourceId(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-lavender/70 outline-none focus:border-ocean/50"
              >
                <option value="all">All sources</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Due cards widget */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-serif text-lg text-blush">{dueStates.length} cards due</h2>
                  <p className="text-xs text-lavender/50 mt-0.5">
                    Ready to review now
                  </p>
                </div>
                <Brain size={24} className="text-ocean/60" />
              </div>
              <button
                onClick={() => startSession(true)}
                disabled={dueStates.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-ocean text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-ocean/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start Review Session
                <ChevronRight size={15} />
              </button>
            </div>

            {/* All cards */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="font-serif text-lg text-blush">{allStates.length} total cards</h2>
                  <p className="text-xs text-lavender/50 mt-0.5">Practice all cards</p>
                </div>
              </div>
              <button
                onClick={() => startSession(false)}
                disabled={allStates.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-blush px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Practice All
                <ChevronRight size={15} />
              </button>
            </div>

            {/* Stage breakdown */}
            {allStates.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <h3 className="font-serif text-sm text-lavender/50 mb-4">Progress breakdown</h3>
                <div className="space-y-2.5">
                  {([0, 1, 2, 3] as const).map((stage) => {
                    const count = allStates.filter((s) => s.interval_stage === stage).length
                    return (
                      <div key={stage} className="flex items-center gap-3">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: stageColors[stage] }}
                        />
                        <span className="text-xs text-lavender/60 w-16">{stageLabels[stage]}</span>
                        <div className="flex-1 bg-white/5 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full transition-all"
                            style={{
                              width: `${(count / allStates.length) * 100}%`,
                              backgroundColor: stageColors[stage],
                            }}
                          />
                        </div>
                        <span className="text-xs text-lavender/40 w-6 text-right">{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {allStates.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-lavender/40">
                <BookOpen size={36} strokeWidth={1} />
                <p className="text-sm">Take notes while reading to create flashcards.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Done view ──────────────────────────────────────────────────────────────

  if (mode === 'done') {
    const total = sessionResults.correct + sessionResults.incorrect
    const pct = total > 0 ? Math.round((sessionResults.correct / total) * 100) : 0
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-10 max-w-sm w-full text-center space-y-6">
          <Brain size={40} className="text-ocean mx-auto" />
          <div>
            <h2 className="font-serif text-2xl text-blush">{pct}% correct</h2>
            <p className="text-lavender/50 text-sm mt-1">
              {sessionResults.correct} right · {sessionResults.incorrect} wrong
            </p>
          </div>
          <p className="text-xs text-lavender/40">
            Cards updated with new intervals. Great work!
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setMode('menu')}
              className="flex-1 py-2.5 border border-white/10 rounded-xl text-sm text-lavender/70 hover:bg-white/5 transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => startSession(false)}
              className="flex-1 py-2.5 bg-ocean text-white rounded-xl text-sm font-medium hover:bg-ocean/80 transition-colors flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={13} />
              Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Session view ───────────────────────────────────────────────────────────

  if (!currentNote) return null

  const progress = ((currentIndex) / sessionCards.length) * 100

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Progress */}
      <div className="shrink-0">
        <div className="h-1 bg-white/5">
          <div
            className="h-1 bg-ocean transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between px-8 py-3 border-b border-white/5">
          <button
            onClick={() => setMode('menu')}
            className="text-xs text-lavender/40 hover:text-lavender transition-colors flex items-center gap-1"
          >
            <X size={12} />
            End session
          </button>
          <span className="text-xs text-lavender/50">
            {currentIndex + 1} / {sessionCards.length}
          </span>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-sage">{sessionResults.correct} ✓</span>
            <span className="text-red-400/70">{sessionResults.incorrect} ✗</span>
          </div>
        </div>
      </div>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-xl">
          {/* Stage badge */}
          {currentState && (
            <div className="flex justify-center mb-4">
              <span
                className="text-xs px-2.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${stageColors[currentState.interval_stage]}20`,
                  color: stageColors[currentState.interval_stage],
                }}
              >
                {stageLabels[currentState.interval_stage]}
              </span>
            </div>
          )}

          <div
            onClick={() => setFlipped((f) => !f)}
            className={clsx(
              'bg-white/5 border rounded-2xl p-8 min-h-52 flex flex-col items-center justify-center cursor-pointer transition-all',
              flipped ? 'border-sage/30' : 'border-white/10 hover:border-ocean/30'
            )}
          >
            {!flipped ? (
              <div className="text-center">
                <p className="text-xs text-lavender/40 mb-4 uppercase tracking-widest">Term</p>
                <p className="font-serif text-2xl text-blush">{currentNote.term}</p>
                <p className="text-xs text-lavender/30 mt-6">Click to reveal definition</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-xs text-sage/60 mb-4 uppercase tracking-widest">Definition</p>
                <p className="text-base text-blush/90 leading-relaxed">{currentNote.definition}</p>
              </div>
            )}
          </div>

          {flipped && (
            <div className="flex gap-4 mt-6">
              <button
                onClick={() => handleAnswer(false)}
                className="flex-1 flex items-center justify-center gap-2 py-3 border border-red-400/20 text-red-400/70 rounded-xl hover:bg-red-500/10 hover:text-red-400 transition-colors"
              >
                <X size={16} />
                Didn't know
              </button>
              <button
                onClick={() => handleAnswer(true)}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-sage/10 border border-sage/20 text-sage rounded-xl hover:bg-sage/20 transition-colors"
              >
                <Check size={16} />
                Got it
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
