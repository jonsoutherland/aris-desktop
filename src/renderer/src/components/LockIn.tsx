import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Lock, AlertTriangle, CheckCircle, ChevronDown, BookOpen } from 'lucide-react'
import { useStore } from '../store'
import { clsx } from 'clsx'

const PARTICLE_COLORS = ['#7fbeab', '#2978a0', '#e3d0d8', '#aea3b0', '#7fbeab', '#2978a0']
const EMERGENCY_HOLD_MS = 3000

function formatTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function useParticles() {
  return useMemo(() =>
    Array.from({ length: 18 }, (_, i) => {
      const angle = (i / 18) * 2 * Math.PI
      const dist = 90 + Math.floor(Math.random() * 130)
      return {
        id: i,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
        delay: (i / 18) * 0.9,
        tx: `${Math.round(Math.cos(angle) * dist)}px`,
        ty: `${Math.round(Math.sin(angle) * dist)}px`,
        size: 6 + (i % 3) * 3,
      }
    }), [])
}

export default function LockIn() {
  const {
    lockInPhase,
    lockInDurationMs,
    lockInStartTime,
    lockInPenaltyMs,
    lockInPenaltyEndTime,
    lockInExitCount,
    lockInStartPage,
    lockInStartNoteCount,
    notes,
    activePage,
    sources,
    activeSourceId,
    setActiveSource,
    setView,
    triggerLockInExit,
    penaltyComplete,
    completeLockIn,
    resetLockIn,
  } = useStore()

  const [timeLeft, setTimeLeft] = useState(lockInDurationMs)
  const [penaltyLeft, setPenaltyLeft] = useState(0)
  const [showEntry, setShowEntry] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [sourcePicker, setSourcePicker] = useState(false)
  const holdRafRef = useRef<number>(0)
  const holdStartRef = useRef<number>(0)
  const sourcePickerRef = useRef<HTMLDivElement>(null)
  const particles = useParticles()

  const activeSource = sources.find((s) => s.id === activeSourceId)

  // Register exit-attempt listener while session is live
  useEffect(() => {
    if (lockInPhase === 'active' || lockInPhase === 'penalty') {
      window.api.window.onExitAttempt(triggerLockInExit)
      return () => window.api.window.offExitAttempt()
    }
  }, [lockInPhase, triggerLockInExit])

  // Entry animation — fires on new session
  useEffect(() => {
    if (lockInPhase !== 'active') return
    setShowEntry(true)
    setTimeLeft(lockInDurationMs)
    const t = setTimeout(() => setShowEntry(false), 1900)
    return () => clearTimeout(t)
  }, [lockInStartTime]) // eslint-disable-line react-hooks/exhaustive-deps

  // Main countdown
  useEffect(() => {
    if (lockInPhase !== 'active') return
    const id = setInterval(() => {
      const remaining = lockInDurationMs - (Date.now() - lockInStartTime)
      if (remaining <= 0) {
        completeLockIn()
        clearInterval(id)
      } else {
        setTimeLeft(remaining)
      }
    }, 500)
    return () => clearInterval(id)
  }, [lockInPhase, lockInDurationMs, lockInStartTime, completeLockIn])

  // Penalty countdown
  useEffect(() => {
    if (lockInPhase !== 'penalty' || !lockInPenaltyEndTime) return
    setPenaltyLeft(Math.ceil((lockInPenaltyEndTime - Date.now()) / 1000))
    const id = setInterval(() => {
      const remaining = lockInPenaltyEndTime - Date.now()
      if (remaining <= 0) {
        setPenaltyLeft(0)
        clearInterval(id)
        penaltyComplete()
      } else {
        setPenaltyLeft(Math.ceil(remaining / 1000))
      }
    }, 100)
    return () => clearInterval(id)
  }, [lockInPhase, lockInPenaltyEndTime, penaltyComplete])

  // Close source picker on outside click
  useEffect(() => {
    if (!sourcePicker) return
    const handler = (e: MouseEvent) => {
      if (sourcePickerRef.current && !sourcePickerRef.current.contains(e.target as Node)) {
        setSourcePicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sourcePicker])

  // Emergency-exit hold
  const handleHoldStart = useCallback(() => {
    holdStartRef.current = Date.now()
    const tick = () => {
      const elapsed = Date.now() - holdStartRef.current
      const progress = Math.min(elapsed / EMERGENCY_HOLD_MS, 1)
      setHoldProgress(progress)
      if (progress < 1) {
        holdRafRef.current = requestAnimationFrame(tick)
      } else {
        resetLockIn()
        setHoldProgress(0)
      }
    }
    holdRafRef.current = requestAnimationFrame(tick)
  }, [resetLockIn])

  const handleHoldEnd = useCallback(() => {
    cancelAnimationFrame(holdRafRef.current)
    setHoldProgress(0)
  }, [])

  const handlePickSource = useCallback((id: string) => {
    setActiveSource(id)
    setView('reader')
    setSourcePicker(false)
  }, [setActiveSource, setView])

  if (lockInPhase === 'idle') return null

  const notesDelta = notes.length - lockInStartNoteCount
  const pagesDelta = Math.max(0, activePage - lockInStartPage)
  const isLive = lockInPhase === 'active' || lockInPhase === 'penalty'

  return (
    <>
      {/* ── Entry animation overlay ── */}
      {showEntry && (
        <div className="fixed inset-0 z-[200] bg-ink flex items-center justify-center pointer-events-none lockin-entry-overlay">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="absolute inset-0 rounded-full lockin-ripple" style={{ background: 'rgba(127,190,171,0.25)' }} />
              <div className="relative bg-ink/80 rounded-full p-8">
                <Lock size={72} className="text-sage lockin-lock-bounce" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-3xl font-serif font-bold text-blush tracking-wide">Locking In</p>
              <p className="text-lavender/70 text-sm mt-2">Focus mode activated · {formatTime(lockInDurationMs)}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Active top bar ── */}
      {!showEntry && isLive && (
        <div
          className="fixed top-0 left-0 right-0 z-[100] h-11 bg-ink/92 backdrop-blur-sm border-b border-white/5 flex items-center px-4 gap-3 lockin-bar-enter select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <Lock size={13} className="text-sage shrink-0" />
          <span className="font-serif text-[11px] text-ocean tracking-widest font-bold uppercase shrink-0">Lock In</span>

          {/* Source picker */}
          <div
            className="relative"
            ref={sourcePickerRef}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={() => setSourcePicker((v) => !v)}
              className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors max-w-[220px]',
                sourcePicker
                  ? 'bg-white/10 text-blush'
                  : 'text-lavender/60 hover:text-blush hover:bg-white/8'
              )}
            >
              <BookOpen size={11} className="shrink-0" />
              <span className="truncate">
                {activeSource ? activeSource.title : 'Pick source'}
              </span>
              <ChevronDown size={10} className={clsx('shrink-0 transition-transform', sourcePicker && 'rotate-180')} />
            </button>

            {sourcePicker && (
              <div className="absolute top-full left-0 mt-1.5 w-64 bg-[#1e2535] border border-white/10 rounded-xl shadow-xl overflow-hidden z-[200]">
                {sources.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-lavender/40">No sources in library</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto py-1">
                    {sources.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => handlePickSource(s.id)}
                        className={clsx(
                          'w-full text-left px-3 py-2.5 text-xs transition-colors flex items-start gap-2.5',
                          s.id === activeSourceId
                            ? 'bg-ocean/15 text-ocean'
                            : 'text-lavender/70 hover:bg-white/5 hover:text-blush'
                        )}
                      >
                        <BookOpen size={12} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.title}</p>
                          <p className="text-[10px] text-lavender/40 mt-0.5 uppercase tracking-wide">{s.type}</p>
                        </div>
                        {s.id === activeSourceId && (
                          <span className="ml-auto shrink-0 text-[10px] text-ocean/70">current</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" />
          <span className={clsx(
            'font-mono text-sm font-bold tabular-nums transition-colors shrink-0',
            timeLeft < 60000 ? 'text-red-400 animate-pulse' : 'text-sage'
          )}>
            {formatTime(timeLeft)}
          </span>
          <div className="flex-1" />

          {/* Emergency exit — hold for 3 s */}
          <div
            className="relative overflow-hidden flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer select-none"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseDown={handleHoldStart}
            onMouseUp={handleHoldEnd}
            onMouseLeave={handleHoldEnd}
            title="Hold 3 seconds to emergency-exit"
          >
            {holdProgress > 0 && (
              <div
                className="absolute inset-0 bg-red-500/25 rounded transition-none"
                style={{ width: `${holdProgress * 100}%` }}
              />
            )}
            <AlertTriangle size={10} className="relative text-lavender/30 hover:text-lavender/60 transition-colors" />
            <span className="relative text-[10px] text-lavender/30 hover:text-lavender/60 transition-colors">
              {holdProgress > 0 ? 'keep holding…' : 'hold to exit'}
            </span>
          </div>
        </div>
      )}

      {/* ── Penalty overlay ── */}
      {lockInPhase === 'penalty' && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center penalty-fade-in"
          style={{ background: 'rgba(24,29,39,0.88)', backdropFilter: 'blur(6px)' }}
        >
          <div className="flex flex-col items-center gap-5 text-center px-8">
            <div className="penalty-shake">
              <AlertTriangle size={52} className="text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-serif font-bold text-blush">Stay focused!</p>
              <p className="text-lavender/60 text-sm mt-1">
                {lockInExitCount === 1 ? 'First' : `Exit #${lockInExitCount}`} attempt
                {lockInExitCount > 1 && ` · next penalty ${formatTime(lockInPenaltyMs)}`}
              </p>
            </div>
            <p className="text-7xl font-mono font-bold text-amber-400 tabular-nums leading-none">
              {penaltyLeft}
            </p>
            <p className="text-lavender/40 text-xs">seconds before you can leave</p>
          </div>
        </div>
      )}

      {/* ── Completion overlay ── */}
      {lockInPhase === 'complete' && (
        <div className="fixed inset-0 z-[200] bg-ink flex items-center justify-center overflow-hidden">
          {particles.map((p) => (
            <div
              key={p.id}
              className="particle"
              style={{
                width: p.size,
                height: p.size,
                background: p.color,
                animationDelay: `${p.delay}s`,
                '--tx': p.tx,
                '--ty': p.ty,
              } as React.CSSProperties}
            />
          ))}

          <div className="flex flex-col items-center gap-7 text-center z-10 completion-in">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-sage/15 animate-pulse" style={{ transform: 'scale(1.4)' }} />
              <div className="relative bg-ink/80 rounded-full p-7">
                <CheckCircle size={72} className="text-sage" />
              </div>
            </div>

            <div>
              <p className="text-4xl font-serif font-bold text-blush">Session Complete!</p>
              <p className="text-lavender/60 text-base mt-2">
                {formatTime(lockInDurationMs)} of focused work. Well done.
              </p>
            </div>

            <div className="flex gap-4">
              <div className="bg-white/5 rounded-2xl px-6 py-5 text-center stat-reveal" style={{ animationDelay: '0.3s' }}>
                <p className="text-4xl font-bold text-sage">{notesDelta}</p>
                <p className="text-lavender/50 text-xs mt-1.5">notes taken</p>
              </div>
              <div className="bg-white/5 rounded-2xl px-6 py-5 text-center stat-reveal" style={{ animationDelay: '0.45s' }}>
                <p className="text-4xl font-bold text-ocean">{pagesDelta}</p>
                <p className="text-lavender/50 text-xs mt-1.5">pages read</p>
              </div>
              <div className="bg-white/5 rounded-2xl px-6 py-5 text-center stat-reveal" style={{ animationDelay: '0.6s' }}>
                <p className="text-4xl font-bold text-amber-400">{lockInExitCount}</p>
                <p className="text-lavender/50 text-xs mt-1.5">exit attempts</p>
              </div>
            </div>

            <button
              onClick={resetLockIn}
              className="px-10 py-3 bg-sage text-ink font-bold rounded-xl hover:bg-sage/85 active:scale-95 transition-all text-sm stat-reveal"
              style={{ animationDelay: '0.75s' }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
