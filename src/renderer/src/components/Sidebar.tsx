import { useState } from 'react'
import { BookOpen, FileText, Layers, Brain, Network, Settings, ChevronRight, Target, Lock, X, Clock, Quote, Lightbulb } from 'lucide-react'
import { useStore } from '../store'
import type { View } from '../types'
import { clsx } from 'clsx'

interface NavItem {
  id: View
  label: string
  icon: React.FC<{ size?: number }>
  requiresSource?: boolean
}

const navItems: NavItem[] = [
  { id: 'library', label: 'Library', icon: BookOpen },
  { id: 'reader', label: 'Reader', icon: FileText, requiresSource: true },
  { id: 'notes', label: 'Notes', icon: Layers },
  { id: 'flashcards', label: 'Flashcards', icon: Brain },
  { id: 'graph', label: 'Knowledge Graph', icon: Network },
  { id: 'goals', label: 'Reading Goals', icon: Target },
  { id: 'citations', label: 'Citations', icon: Quote },
  { id: 'tips', label: 'Tips & Tricks', icon: Lightbulb },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const PRESETS = [
  { label: '15 min', ms: 15 * 60 * 1000 },
  { label: '25 min', ms: 25 * 60 * 1000 },
  { label: '45 min', ms: 45 * 60 * 1000 },
  { label: '60 min', ms: 60 * 60 * 1000 },
]

export default function Sidebar() {
  const { view, setView, activeSourceId, sources, flashcardStates, lockInSetupOpen, setLockInSetupOpen, startLockIn } =
    useStore()

  const [customMin, setCustomMin] = useState('')
  const [selectedMs, setSelectedMs] = useState(PRESETS[1].ms)

  const dueCount = flashcardStates.filter((s) => s.next_review <= Date.now()).length
  const source = sources.find((s) => s.id === activeSourceId)

  const handleStart = () => {
    const custom = parseInt(customMin, 10)
    const ms = customMin && custom > 0 ? custom * 60 * 1000 : selectedMs
    startLockIn(ms)
    setCustomMin('')
  }

  return (
    <>
      <aside className="w-52 shrink-0 flex flex-col bg-ink border-r border-white/5 pt-2">
        {source && (
          <div className="px-3 pb-3 border-b border-white/5 mb-1">
            <p className="text-xs text-lavender/50 mb-1">Reading</p>
            <p className="text-xs text-sage truncate font-medium">{source.title}</p>
            <p className="text-xs text-lavender/40">
              p. {source.current_page}
              {source.total_pages ? ` / ${source.total_pages}` : ''}
            </p>
          </div>
        )}

        <nav className="flex-1 flex flex-col gap-0.5 px-2">
          {navItems.map((item) => {
            const disabled = item.requiresSource && !activeSourceId
            const isActive = view === item.id
            return (
              <button
                key={item.id}
                onClick={() => !disabled && setView(item.id)}
                disabled={disabled}
                className={clsx(
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all text-left w-full',
                  isActive
                    ? 'bg-ocean/20 text-ocean'
                    : disabled
                    ? 'text-lavender/20 cursor-not-allowed'
                    : 'text-lavender/70 hover:text-blush hover:bg-white/5'
                )}
              >
                <item.icon size={15} />
                <span className="flex-1">{item.label}</span>
                {item.id === 'flashcards' && dueCount > 0 && (
                  <span className="bg-ocean text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                    {dueCount}
                  </span>
                )}
                {isActive && <ChevronRight size={12} className="text-ocean/60" />}
              </button>
            )
          })}
        </nav>

        {/* Lock In button */}
        <div className="px-2 pb-2">
          <button
            onClick={() => setLockInSetupOpen(true)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-bold bg-sage/10 text-sage hover:bg-sage/20 transition-all border border-sage/20 hover:border-sage/40"
          >
            <Lock size={14} />
            <span className="flex-1 text-left">Lock In</span>
            <Clock size={12} className="text-sage/50" />
          </button>
        </div>

        <div className="p-3 border-t border-white/5">
          <p className="text-[10px] text-lavender/30 text-center">Aris v1.1</p>
        </div>
      </aside>

      {/* Lock-In setup modal */}
      {lockInSetupOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center"
          style={{ background: 'rgba(24,29,39,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={(e) => e.target === e.currentTarget && setLockInSetupOpen(false)}
        >
          <div className="bg-[#1e2535] rounded-2xl border border-white/8 shadow-2xl w-80 p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Lock size={18} className="text-sage" />
                <h2 className="text-base font-bold text-blush">Lock In</h2>
              </div>
              <button
                onClick={() => setLockInSetupOpen(false)}
                className="text-lavender/40 hover:text-lavender transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-lavender/60 leading-relaxed -mt-2">
              Full-screen focus mode. Alt-tabbing triggers a cooldown penalty that grows with each exit.
            </p>

            {/* Preset durations */}
            <div>
              <p className="text-[10px] text-lavender/50 uppercase tracking-widest mb-2">Duration</p>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.ms}
                    onClick={() => { setSelectedMs(p.ms); setCustomMin('') }}
                    className={clsx(
                      'py-2.5 rounded-lg text-xs font-bold transition-all border',
                      selectedMs === p.ms && !customMin
                        ? 'bg-sage/20 text-sage border-sage/40'
                        : 'bg-white/5 text-lavender/60 border-white/5 hover:border-white/15 hover:text-blush'
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom duration */}
            <div>
              <p className="text-[10px] text-lavender/50 uppercase tracking-widest mb-2">Custom (minutes)</p>
              <input
                type="number"
                min="1"
                max="480"
                placeholder="e.g. 90"
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-blush placeholder-lavender/30 focus:outline-none focus:border-sage/50 transition-colors"
              />
            </div>

            {/* Start button */}
            <button
              onClick={handleStart}
              className="w-full py-3 bg-sage text-ink font-bold rounded-xl hover:bg-sage/85 active:scale-95 transition-all text-sm flex items-center justify-center gap-2"
            >
              <Lock size={14} />
              Lock In
            </button>
          </div>
        </div>
      )}
    </>
  )
}
