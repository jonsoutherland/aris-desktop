import { useState, useEffect, useCallback, useRef } from 'react'
import {
  BookOpen, Highlighter, Brain, FileText, Network, Quote,
  Check, ChevronRight, X, NotebookPen, Lock, BookMarked,
  Volume2, Plus, AlertTriangle, CheckCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import NoteNode from './NoteNode'

// ── Shared passage ────────────────────────────────────────────────────────────
const RAW =
  'Knowledge compounds over time. The more you know, the faster you learn. ' +
  'Deep work is the ability to focus without distraction on cognitively demanding tasks. ' +
  'The best ideas emerge from connecting unrelated domains.'

interface Token { display: string; text: string; term: string }

const TOKENS: Token[] = RAW.split(' ').map((w, i, arr) => ({
  display: w + (i < arr.length - 1 ? ' ' : ''),
  text: w,
  term: w.replace(/[^a-zA-Z''-]/g, ''),
}))

// ── Highlight color options ───────────────────────────────────────────────────
const HL_TYPES = [
  { id: 'blue',  label: 'Ocean', hex: '#2978a0' },
  { id: 'green', label: 'Sage',  hex: '#7fbeab' },
  { id: 'pink',  label: 'Blush', hex: '#e3d0d8' },
]

// ── State shared across steps ─────────────────────────────────────────────────
interface SharedState {
  hlText: string
  hlRange: [number, number] | null
  hlTypeId: string
  onHighlight: (text: string, s: number, e: number, typeId: string) => void
  savedNote: { term: string; definition: string } | null
  onSaveNote: (term: string, definition: string) => void
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────
function WelcomeDemo(_props: { shared: SharedState }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 60)
    return () => clearTimeout(t)
  }, [])

  const features = [
    { Icon: BookOpen,    color: 'text-ocean',    bg: 'bg-ocean/15',    label: 'Library'    },
    { Icon: Highlighter, color: 'text-blush',    bg: 'bg-blush/15',    label: 'Highlights' },
    { Icon: FileText,    color: 'text-sage',     bg: 'bg-sage/15',     label: 'Notes'      },
    { Icon: Brain,       color: 'text-lavender', bg: 'bg-lavender/15', label: 'Flashcards' },
    { Icon: Quote,       color: 'text-ocean',    bg: 'bg-ocean/15',    label: 'Citations'  },
    { Icon: Network,     color: 'text-sage',     bg: 'bg-sage/15',     label: 'Graph'      },
    { Icon: BookMarked,  color: 'text-ocean',    bg: 'bg-ocean/15',    label: 'Vocab'      },
    { Icon: Lock,        color: 'text-blush',    bg: 'bg-blush/15',    label: 'Lock-In'    },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {features.map(({ Icon, color, bg, label }, i) => (
        <div
          key={label}
          className="flex flex-col items-center gap-2 transition-all"
          style={{
            transitionDuration: '380ms',
            transitionDelay: `${i * 55}ms`,
            opacity: show ? 1 : 0,
            transform: show ? 'translateY(0)' : 'translateY(10px)',
          }}
        >
          <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center', bg)}>
            <Icon size={20} className={color} strokeWidth={1.5} />
          </div>
          <span className="text-[9px] text-lavender/50">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Step 2: Highlights ────────────────────────────────────────────────────────
function HighlightDemo({ shared }: { shared: SharedState }) {
  const [activeType, setActiveType] = useState('blue')
  const [selecting, setSelecting] = useState(false)
  const [selStart, setSelStart] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const [highlights, setHighlights] = useState<{ s: number; e: number; typeId: string }[]>([])
  const [flash, setFlash] = useState(false)

  const getWordBg = (i: number): string => {
    if (selecting && selStart !== null && selEnd !== null) {
      const lo = Math.min(selStart, selEnd)
      const hi = Math.max(selStart, selEnd)
      if (i >= lo && i <= hi) return 'rgba(56,189,248,0.28)'
    }
    for (let h = highlights.length - 1; h >= 0; h--) {
      if (i >= highlights[h].s && i <= highlights[h].e)
        return HL_TYPES.find((t) => t.id === highlights[h].typeId)!.hex + '44'
    }
    return 'transparent'
  }

  const commit = () => {
    if (!selecting || selStart === null || selEnd === null) return
    const s = Math.min(selStart, selEnd)
    const e = Math.max(selStart, selEnd)
    setHighlights((prev) => [...prev, { s, e, typeId: activeType }])
    const text = TOKENS.slice(s, e + 1).map((t) => t.text).join(' ')
    shared.onHighlight(text, s, e, activeType)
    setSelecting(false)
    setSelStart(null)
    setSelEnd(null)
    setFlash(true)
    setTimeout(() => setFlash(false), 1500)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-3 py-2 bg-ink border border-white/10 rounded-xl text-[11px]">
        <Highlighter size={12} className="text-lavender/40" />
        <span className="text-lavender/35 mr-0.5">Color:</span>
        {HL_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveType(t.id)}
            className={clsx(
              'flex items-center gap-1.5 px-2 py-0.5 rounded-lg transition-all',
              activeType === t.id ? 'bg-white/10' : 'hover:bg-white/5'
            )}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: t.hex }} />
            {activeType === t.id && <span className="text-lavender/70">{t.label}</span>}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        {flash ? '✓ Highlight saved!' : 'Click and drag across the text to highlight it'}
      </p>

      <div
        className="bg-white/3 rounded-xl p-4 border border-white/5 leading-loose select-none cursor-text"
        onMouseUp={commit}
        onMouseLeave={() => selecting && commit()}
      >
        {TOKENS.map((tok, i) => (
          <span
            key={i}
            onMouseDown={(e) => {
              e.preventDefault()
              setSelecting(true)
              setSelStart(i)
              setSelEnd(i)
            }}
            onMouseEnter={() => { if (selecting) setSelEnd(i) }}
            style={{
              fontSize: 12,
              color: 'rgba(227,208,216,0.8)',
              cursor: 'text',
              backgroundColor: getWordBg(i),
            }}
          >
            {tok.display}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Step 3: Notes - term & definition ─────────────────────────────────────────
type NotePhase = 'idle' | 'menu' | 'waiting' | 'panel' | 'done'

function NoteDemo({ shared }: { shared: SharedState }) {
  const [phase, setPhase] = useState<NotePhase>('idle')
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [termSelecting, setTermSelecting] = useState(false)
  const [termSelStart, setTermSelStart] = useState<number | null>(null)
  const [termSelEnd, setTermSelEnd] = useState<number | null>(null)
  const [defSelecting, setDefSelecting] = useState(false)
  const [defSelStart, setDefSelStart] = useState<number | null>(null)
  const [defSelEnd, setDefSelEnd] = useState<number | null>(null)

  const hlType = HL_TYPES.find((t) => t.id === shared.hlTypeId) ?? HL_TYPES[0]

  const commitTermSelection = () => {
    if (termSelStart !== null && termSelEnd !== null && termSelStart !== termSelEnd) {
      const s = Math.min(termSelStart, termSelEnd)
      const e = Math.max(termSelStart, termSelEnd)
      const text = TOKENS.slice(s, e + 1).map((t) => t.term || t.text).join(' ').trim()
      if (text) { setTerm(text); setPhase('menu') }
    }
    setTermSelecting(false)
    setTermSelStart(null)
    setTermSelEnd(null)
  }

  const pickDefinition = (text: string) => {
    setDefinition(text)
    setPhase('panel')
  }

  const commitDefSelection = () => {
    if (defSelStart !== null && defSelEnd !== null) {
      const s = Math.min(defSelStart, defSelEnd)
      const e = Math.max(defSelStart, defSelEnd)
      const text = TOKENS.slice(s, e + 1).map((t) => t.text).join(' ')
      if (text) pickDefinition(text)
    }
    setDefSelecting(false)
    setDefSelStart(null)
    setDefSelEnd(null)
  }

  const handleSave = () => {
    shared.onSaveNote(term, definition)
    setPhase('done')
  }

  const hints: Record<NotePhase, string> = {
    idle:    'Double-click a word or drag across multiple words to select a term',
    menu:    'Choose "Create note" from the menu',
    waiting: shared.hlText
      ? 'Click your highlight to use it, or drag across the passage to select a definition'
      : 'Drag across the passage to select text as the definition',
    panel:   'Review the pre-filled note and save it',
    done:    '✓ Note saved - flashcard auto-created',
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        {hints[phase]}
      </p>

      {phase === 'idle' && (
        <div
          className="bg-white/3 rounded-xl p-4 border border-white/5 leading-loose select-none cursor-text"
          onMouseUp={commitTermSelection}
          onMouseLeave={() => termSelecting && commitTermSelection()}
        >
          {TOKENS.map((tok, i) => {
            const inSel =
              termSelecting &&
              termSelStart !== null &&
              termSelEnd !== null &&
              i >= Math.min(termSelStart, termSelEnd) &&
              i <= Math.max(termSelStart, termSelEnd)
            const inHl =
              !inSel &&
              shared.hlRange !== null &&
              i >= shared.hlRange[0] &&
              i <= shared.hlRange[1]
            return (
              <span
                key={i}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setTermSelecting(true)
                  setTermSelStart(i)
                  setTermSelEnd(i)
                }}
                onMouseEnter={() => { if (termSelecting) setTermSelEnd(i) }}
                onDoubleClick={() => {
                  if (tok.term) { setTerm(tok.term); setPhase('menu') }
                  setTermSelecting(false)
                  setTermSelStart(null)
                  setTermSelEnd(null)
                }}
                style={{
                  fontSize: 12,
                  color: inSel ? '#e3d0d8' : inHl ? '#e3d0d8' : 'rgba(227,208,216,0.55)',
                  cursor: 'text',
                  backgroundColor: inSel
                    ? 'rgba(41,120,160,0.35)'
                    : inHl
                      ? hlType.hex + '44'
                      : 'transparent',
                }}
              >
                {tok.display}
              </span>
            )
          })}
          <p className="text-[9px] text-lavender/25 mt-2 text-center block">
            Double-click a word or drag to select a term
          </p>
        </div>
      )}

      {phase === 'menu' && (
        <div className="space-y-2">
          <div className="bg-white/3 rounded-xl p-4 border border-white/5 leading-relaxed select-none opacity-30 pointer-events-none overflow-hidden">
            {TOKENS.map((tok, i) => (
              <span key={i} style={{ fontSize: 12, color: '#e3d0d8' }}>
                {tok.display}
              </span>
            ))}
          </div>
          <div className="flex justify-center">
            <div
              className="bg-[#1e2535] border border-white/10 rounded-xl shadow-2xl px-2 py-2 flex flex-col gap-1"
              style={{ width: 224 }}
            >
              <p className="px-2 pb-1 text-[10px] text-lavender/40 border-b border-white/5 mb-0.5 truncate">
                &ldquo;{term}&rdquo;
              </p>
              <button
                onClick={() => setPhase('waiting')}
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-blush hover:bg-white/8 transition-colors text-left"
              >
                <NotebookPen size={13} className="text-ocean shrink-0" />
                Create note
              </button>
              <button
                disabled
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-blush/25 text-left cursor-default"
              >
                <BookOpen size={13} className="text-sage/25 shrink-0" />
                Look up definition
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'waiting' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 bg-ink border border-sage/40 text-[11px] px-2.5 py-1.5 rounded-lg shadow-xl w-fit mx-auto whitespace-nowrap">
            <span className="text-sage font-medium">&ldquo;{term}&rdquo;</span>
            <span className="text-lavender/40">→</span>
            <span className="text-lavender/60">drag to select definition</span>
            <button
              onClick={() => setPhase('idle')}
              className="ml-0.5 text-lavender/30 hover:text-lavender/70 transition-colors"
            >
              ✕
            </button>
          </div>

          {shared.hlText && (
            <div
              onClick={() => pickDefinition(shared.hlText)}
              className="rounded-xl px-3 py-2 cursor-pointer transition-opacity hover:opacity-80 space-y-0.5"
              style={{
                backgroundColor: hlType.hex + '2a',
                border: `1px solid ${hlType.hex}44`,
              }}
            >
              <p className="text-[9px] uppercase tracking-widest" style={{ color: hlType.hex }}>
                Your highlight - click to use
              </p>
              <p className="text-xs text-blush leading-relaxed">{shared.hlText}</p>
            </div>
          )}

          <div
            className="bg-white/3 rounded-xl p-4 border border-white/5 leading-loose select-none cursor-text"
            onMouseUp={commitDefSelection}
            onMouseLeave={() => defSelecting && commitDefSelection()}
          >
            <p className="text-[9px] text-lavender/30 mb-2">
              Drag across any part of the text below to use it as the definition
            </p>
            {TOKENS.map((tok, i) => {
              const inSel =
                defSelecting &&
                defSelStart !== null &&
                defSelEnd !== null &&
                i >= Math.min(defSelStart, defSelEnd) &&
                i <= Math.max(defSelStart, defSelEnd)
              return (
                <span
                  key={i}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setDefSelecting(true)
                    setDefSelStart(i)
                    setDefSelEnd(i)
                  }}
                  onMouseEnter={() => { if (defSelecting) setDefSelEnd(i) }}
                  style={{
                    fontSize: 12,
                    color: 'rgba(227,208,216,0.8)',
                    cursor: 'text',
                    backgroundColor: inSel ? 'rgba(41,120,160,0.35)' : 'transparent',
                  }}
                >
                  {tok.display}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {phase === 'panel' && (
        <div className="bg-ink border border-white/10 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <h3 className="font-serif text-sm text-blush">New Note</h3>
            <button
              onClick={() => setPhase('idle')}
              className="text-lavender/40 hover:text-lavender transition-colors"
            >
              <X size={13} />
            </button>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[10px] text-sage font-medium block mb-1">Term</label>
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blush">
                {term}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-lavender/60 font-medium block mb-1">
                Definition / Notes
              </label>
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blush/80 leading-relaxed">
                {definition}
              </div>
            </div>
            <button
              onClick={handleSave}
              className="flex items-center justify-center gap-2 w-full bg-ocean text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-ocean/80 transition-colors"
            >
              <Check size={13} />
              Save Note
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div
          className="rounded-xl p-4 text-center space-y-1.5 border"
          style={{ backgroundColor: '#7fbeab0d', borderColor: '#7fbeab33' }}
        >
          <div className="w-8 h-8 rounded-full bg-sage/20 flex items-center justify-center mx-auto">
            <Check size={16} className="text-sage" />
          </div>
          <p className="text-sm text-sage font-medium">Note saved</p>
          <p className="text-xs text-lavender/55 leading-relaxed">
            &ldquo;{term}&rdquo; is now a flashcard.<br />
            you&apos;ll review it in 2 days.
          </p>
        </div>
      )}
    </div>
  )
}

// ── Step 4: Flashcards ────────────────────────────────────────────────────────
const STAGE_LABELS = ['New', '2-day', '7-day', '30-day']
const STAGE_COLORS = ['#aea3b0', '#2978a0', '#7fbeab', '#e3d0d8']

function FlashcardDemo({ shared }: { shared: SharedState }) {
  const [flipped, setFlipped] = useState(false)
  const [answered, setAnswered] = useState<'correct' | 'wrong' | null>(null)

  const cardTerm = shared.savedNote?.term ?? 'deep work'
  const cardDef =
    shared.savedNote?.definition ??
    'Deep work is the ability to focus without distraction on cognitively demanding tasks.'

  const reset = () => { setFlipped(false); setAnswered(null) }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        {!flipped
          ? 'Every saved note becomes a flashcard. Click to review it.'
          : answered
            ? answered === 'correct'
              ? 'Card advances to the next stage'
              : 'Card drops back for more practice'
            : 'Did you recall it?'}
      </p>

      <div className="flex items-center justify-center gap-1.5">
        {STAGE_LABELS.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="text-[9px] px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: STAGE_COLORS[i] + '22', color: STAGE_COLORS[i] }}
            >
              {label}
            </span>
            {i < STAGE_LABELS.length - 1 && (
              <span className="text-[9px] text-lavender/20">→</span>
            )}
          </div>
        ))}
      </div>

      <div
        onClick={() => !answered && setFlipped((f) => !f)}
        className={clsx(
          'border rounded-xl p-5 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[100px]',
          flipped
            ? 'bg-white/5 border-sage/30'
            : 'bg-white/5 border-white/10 hover:border-ocean/30'
        )}
      >
        {!flipped ? (
          <div className="text-center space-y-2">
            <p className="text-[9px] text-lavender/40 uppercase tracking-widest">Term</p>
            <p className="font-serif text-xl text-blush">{cardTerm}</p>
            <p className="text-[9px] text-lavender/30">Click to reveal definition</p>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <p className="text-[9px] text-sage/60 uppercase tracking-widest">Definition</p>
            <p className="text-xs text-blush/90 leading-relaxed max-w-[240px]">{cardDef}</p>
          </div>
        )}
      </div>

      {flipped && !answered && (
        <div className="flex gap-3">
          <button
            onClick={() => setAnswered('wrong')}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-red-400/20 text-red-400/70 rounded-xl text-xs hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <X size={14} /> Didn&apos;t know
          </button>
          <button
            onClick={() => setAnswered('correct')}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-sage/10 border border-sage/20 text-sage rounded-xl text-xs hover:bg-sage/20 transition-colors"
          >
            <Check size={14} /> Got it
          </button>
        </div>
      )}

      {answered && (
        <button
          onClick={reset}
          className="flex items-center justify-center gap-1 w-full text-[10px] text-lavender/35 hover:text-lavender/60 transition-colors"
        >
          ↩ Try again
        </button>
      )}
    </div>
  )
}

// ── Step 5: Citations ─────────────────────────────────────────────────────────
type CitStyle = 'APA' | 'MLA' | 'Chicago'

const CITATIONS: Record<CitStyle, string> = {
  APA:     'Newport, C. (2016). Deep Work. Grand Central Publishing. p. 14.',
  MLA:     'Newport, Cal. Deep Work. Grand Central Publishing, 2016. p. 14.',
  Chicago: 'Newport, Cal. Deep Work. New York: Grand Central Publishing, 2016. 14.',
}

function CitationsDemo(_props: { shared: SharedState }) {
  const [style, setStyle] = useState<CitStyle>('APA')
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,216,0.55)' }}>
        Add book info once and citations auto-generate for every highlight
      </p>

      <div className="bg-ocean/10 border border-ocean/20 rounded-xl p-3">
        <p className="text-[9px] text-ocean/60 uppercase tracking-widest mb-1.5">Highlight - p. 14</p>
        <p className="text-xs text-blush/80 italic leading-relaxed">
          &ldquo;Deep work is the ability to focus without distraction on cognitively demanding tasks.&rdquo;
        </p>
      </div>

      <div className="flex gap-1 bg-white/5 p-1 rounded-xl">
        {(['APA', 'MLA', 'Chicago'] as CitStyle[]).map((s) => (
          <button
            key={s}
            onClick={() => setStyle(s)}
            className={clsx(
              'flex-1 py-1.5 rounded-lg text-xs font-medium transition-all',
              style === s ? 'bg-ocean text-white' : 'text-lavender/50 hover:text-lavender/80'
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white/3 border border-white/8 rounded-xl p-3 flex items-start gap-2">
        <p className="text-xs text-blush/80 leading-relaxed flex-1">{CITATIONS[style]}</p>
        <button
          onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className={clsx(
            'shrink-0 text-[10px] px-2.5 py-1 rounded-lg border transition-all',
            copied
              ? 'border-sage/40 text-sage bg-sage/10'
              : 'border-white/10 text-lavender/40 hover:text-lavender/70 hover:border-white/20'
          )}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

// ── Step 6: Knowledge Graph ───────────────────────────────────────────────────
const DEMO_PALETTE = ['#2978a0', '#7fbeab', '#a07fb0', '#d4916a']
const nodeTypes = { noteNode: NoteNode }

function buildDemoNodes(termLabel: string) {
  return [
    { id: '1', type: 'noteNode', position: { x: 40,  y: 30  }, data: { label: termLabel,  color: DEMO_PALETTE[0], animating: false }, style: { width: 170 } },
    { id: '2', type: 'noteNode', position: { x: 260, y: 30  }, data: { label: 'focus',     color: DEMO_PALETTE[1], animating: false }, style: { width: 170 } },
    { id: '3', type: 'noteNode', position: { x: 40,  y: 160 }, data: { label: 'knowledge', color: DEMO_PALETTE[2], animating: false }, style: { width: 170 } },
    { id: '4', type: 'noteNode', position: { x: 260, y: 160 }, data: { label: 'compound',  color: DEMO_PALETTE[3], animating: false }, style: { width: 170 } },
  ]
}

const DEMO_INITIAL_EDGES = [
  { id: '1-2', source: '1', target: '2', style: { stroke: '#2978a0', strokeWidth: 1.5 } },
  { id: '1-3', source: '1', target: '3', style: { stroke: '#2978a0', strokeWidth: 1.5 } },
]

function KnowledgeGraphFlow({ termLabel }: { termLabel: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(buildDemoNodes(termLabel))
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEMO_INITIAL_EDGES)

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => n.id === '1' ? { ...n, data: { ...n.data, label: termLabel } } : n)
    )
  }, [termLabel, setNodes])

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, style: { stroke: '#2978a0', strokeWidth: 1.5 } }, eds)
      ),
    [setEdges]
  )

  return (
    <div style={{ height: 300 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeDoubleClick={(_, edge) =>
          setEdges((eds) => eds.filter((e) => e.id !== edge.id))
        }
        nodeTypes={nodeTypes}
        connectionRadius={130}
        isValidConnection={(c) => c.source !== c.target}
        fitView
        style={{ background: '#181d27', borderRadius: 12 }}
      >
        <Background color="#2978a010" variant={BackgroundVariant.Dots} />
      </ReactFlow>
    </div>
  )
}

function KnowledgeGraphDemo({ shared }: { shared: SharedState }) {
  const rawTerm = shared.savedNote?.term ?? 'deep work'
  const termLabel = rawTerm.length > 14 ? rawTerm.slice(0, 14) + '…' : rawTerm

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        Drag the handle at the bottom of a node to link concepts · double-click an edge to remove it
      </p>
      <div className="rounded-xl overflow-hidden border border-white/5">
        <ReactFlowProvider>
          <KnowledgeGraphFlow termLabel={termLabel} />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

// ── Step 7: Vocab Lookup ──────────────────────────────────────────────────────
interface VocabEntry {
  phonetic: string
  pos: string
  posColor: string
  definition: string
  example: string
  synonyms: string[]
}

const VOCAB_DICT: Record<string, VocabEntry> = {
  cultivate:   { phonetic: '/ˈkʌltɪveɪt/', pos: 'verb',        posColor: 'bg-sage/20 text-sage',        definition: 'To try to acquire or develop a quality, skill, or habit.',                                       example: 'She cultivated a daily reading practice over many months.',  synonyms: ['develop', 'foster', 'nurture'] },
  focus:       { phonetic: '/ˈfoʊkəs/',    pos: 'noun',        posColor: 'bg-ocean/20 text-ocean',      definition: 'The center of interest or activity; a state of clear, undivided attention.',                    example: 'She maintained sharp focus throughout the session.',         synonyms: ['concentration', 'attention', 'center'] },
  every:       { phonetic: '/ˈevri/',      pos: 'adjective',   posColor: 'bg-lavender/20 text-lavender',definition: 'Used to refer to all the individual members of a set without exception.',                       example: 'Every word in the passage can be looked up instantly.',      synonyms: ['each', 'all', 'any'] },
  day:         { phonetic: '/deɪ/',        pos: 'noun',        posColor: 'bg-ocean/20 text-ocean',      definition: 'A period of twenty-four hours as a unit of time, reckoned from midnight to midnight.',          example: 'She read for at least thirty minutes each day.',             synonyms: ['twenty-four hours', 'date', 'period'] },
  guard:       { phonetic: '/ɡɑːrd/',      pos: 'verb',        posColor: 'bg-sage/20 text-sage',        definition: 'To watch over and protect from danger or unwanted intrusion.',                                  example: 'Guard your focus from unnecessary interruptions.',           synonyms: ['protect', 'defend', 'shield'] },
  your:        { phonetic: '/jɔːr/',       pos: 'pronoun',     posColor: 'bg-lavender/20 text-lavender',definition: 'Belonging to or associated with the person or people being addressed.',                         example: 'Your attention is one of your most valuable resources.',    synonyms: ["one's", 'thy'] },
  attention:   { phonetic: '/əˈtenʃən/',   pos: 'noun',        posColor: 'bg-ocean/20 text-ocean',      definition: 'Notice taken of something; mental concentration directed at a task.',                           example: 'Directing attention to one task at a time improves output.', synonyms: ['focus', 'concentration', 'heed'] },
  from:        { phonetic: '/frɒm/',       pos: 'preposition', posColor: 'bg-lavender/20 text-lavender',definition: 'Indicating the point of origin or the starting point of a range.',                              example: 'Free from distraction, she wrote for two uninterrupted hours.', synonyms: ['out of', 'away from'] },
  distraction: { phonetic: '/dɪˈstrækʃən/',pos: 'noun',       posColor: 'bg-lavender/20 text-lavender',definition: 'Something that prevents full attention from being given to a task or activity.',                example: 'Noise is a frequent distraction during deep work.',          synonyms: ['interruption', 'diversion', 'interference'] },
  build:       { phonetic: '/bɪld/',       pos: 'verb',        posColor: 'bg-sage/20 text-sage',        definition: 'To construct or develop something by combining parts or actions over time.',                    example: 'Build a reading habit one page at a time.',                 synonyms: ['construct', 'develop', 'create'] },
  knowledge:   { phonetic: '/ˈnɒlɪdʒ/',   pos: 'noun',        posColor: 'bg-ocean/20 text-ocean',      definition: 'Facts and skills acquired through experience or education; the sum of what is known.',          example: 'A thirst for knowledge drove her reading habit.',            synonyms: ['understanding', 'insight', 'wisdom'] },
  that:        { phonetic: '/ðæt/',        pos: 'conjunction', posColor: 'bg-lavender/20 text-lavender',definition: 'Introducing a subordinate clause expressing a statement, hypothesis, or result.',                example: 'She knew that consistent practice was the key.',             synonyms: ['which', 'who', 'so that'] },
  compounds:   { phonetic: '/ˈkɒmpaʊndz/', pos: 'verb',       posColor: 'bg-sage/20 text-sage',        definition: 'To increase or intensify by successive additions; to accumulate over time.',                    example: 'Knowledge compounds over time with each book read.',         synonyms: ['accumulates', 'multiplies', 'grows'] },
  over:        { phonetic: '/ˈoʊvər/',     pos: 'preposition', posColor: 'bg-lavender/20 text-lavender',definition: 'Throughout the extent or duration of a period of time.',                                        example: 'Her vocabulary expanded over the course of a year.',         synonyms: ['throughout', 'during', 'across'] },
  time:        { phonetic: '/taɪm/',       pos: 'noun',        posColor: 'bg-ocean/20 text-ocean',      definition: 'The indefinite continued progress of existence; a point measured in hours and minutes.',         example: 'Time spent reading is an investment in yourself.',           synonyms: ['duration', 'period', 'age'] },
}

const VOCAB_TOKENS = 'Cultivate focus every day. Guard your attention from distraction. Build knowledge that compounds over time.'
  .split(' ')
  .map((w) => ({ display: w, clean: w.replace(/[^a-zA-Z]/g, '').toLowerCase() }))

function VocabLookupDemo(_props: { shared: SharedState }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [hoveredWord, setHoveredWord] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hoveredRef = useRef<string | null>(null)

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const openPopup = (clean: string) => {
    clearTimer()
    hoveredRef.current = null
    setHoveredWord(null)
    setSelected(clean)
  }

  const startHover = (clean: string) => {
    if (hoveredRef.current === clean) return
    clearTimer()
    hoveredRef.current = clean
    setHoveredWord(clean)
    setHoverKey((k) => k + 1)
    timerRef.current = setTimeout(() => openPopup(clean), 3000)
  }

  const entry = selected ? VOCAB_DICT[selected] : null

  return (
    <div className="space-y-3">
      <style>{`
        @keyframes vocab-prog { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        .vocab-prog-bar { position: absolute; bottom: 0; left: 0; height: 2px; width: 100%; background: #2978a0; border-radius: 1px; transform-origin: left center; animation: vocab-prog 2.5s linear 0.5s both; }
      `}</style>

      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        {selected
          ? `Looking up "${selected}"`
          : hoveredWord
            ? 'Keep hovering…'
            : 'Double-click · Ctrl+hover · or hover 3 s to look up any word'}
      </p>

      <div
        className="bg-white/3 rounded-xl p-4 border border-white/5 text-[12px] leading-loose select-none"
        onMouseLeave={() => { clearTimer(); hoveredRef.current = null; setHoveredWord(null) }}
      >
        {VOCAB_TOKENS.map((tok, i) => (
          <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
            <span
              onMouseMove={(e) => { if (e.ctrlKey) openPopup(tok.clean); else startHover(tok.clean) }}
              onDoubleClick={() => openPopup(tok.clean)}
              style={{
                cursor: 'text',
                display: 'inline-block',
                padding: '0 1px',
                borderRadius: 3,
                color: selected === tok.clean ? '#2978a0' : 'rgba(227,208,216,0.82)',
                backgroundColor: selected === tok.clean
                  ? 'rgba(41,120,160,0.22)'
                  : hoveredWord === tok.clean
                    ? 'rgba(41,120,160,0.12)'
                    : 'transparent',
                transition: 'background-color 0.1s ease',
              }}
            >
              {tok.display}
              {hoveredWord === tok.clean && (
                <span key={`prog-${hoverKey}`} className="vocab-prog-bar" />
              )}
            </span>
            {i < VOCAB_TOKENS.length - 1 && ' '}
          </span>
        ))}
      </div>

      {entry && selected && (
        <div className="bg-[#1e2535] border border-white/10 rounded-xl overflow-hidden">
          <div className="flex items-start justify-between px-4 pt-3 pb-2 border-b border-white/5">
            <div>
              <div className="flex items-center gap-2">
                <BookOpen size={13} className="text-ocean shrink-0" />
                <span className="font-serif text-base font-bold text-blush">{selected}</span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Volume2 size={10} className="text-lavender/40" />
                <span className="text-[11px] text-lavender/50 font-mono">{entry.phonetic}</span>
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="ml-2 mt-0.5 text-lavender/40 hover:text-lavender transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          <div className="px-4 py-3 space-y-2">
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${entry.posColor}`}>
              {entry.pos}
            </span>
            <p className="text-xs text-blush/90 leading-relaxed">{entry.definition}</p>
            <p className="text-[11px] text-lavender/50 italic leading-relaxed">
              &ldquo;{entry.example}&rdquo;
            </p>
            <p className="text-[10px] text-lavender/40">
              <span className="text-lavender/60">Synonyms: </span>
              {entry.synonyms.join(', ')}
            </p>
          </div>

          <div className="px-4 py-2 border-t border-white/5">
            <button
              onClick={() => setAdded((prev) => new Set([...prev, selected]))}
              className="flex items-center gap-1.5 text-xs transition-colors w-full"
              style={{ color: added.has(selected) ? '#7fbeab' : '#aea3b0' }}
            >
              {added.has(selected) ? <Check size={11} /> : <Plus size={11} />}
              {added.has(selected) ? 'Added to Vocabulary' : 'Add as vocab word'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 8: Lock-In Mode ──────────────────────────────────────────────────────
type LockPhase = 'active' | 'penalty' | 'done'

function LockInDemo(_props: { shared: SharedState }) {
  const [phase, setPhase] = useState<LockPhase>('active')

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-center" style={{ color: 'rgba(174,163,176,0.55)' }}>
        {phase === 'active'  && 'A distraction-free countdown session — the app locks you in'}
        {phase === 'penalty' && 'Each exit attempt adds penalty time — stay committed'}
        {phase === 'done'    && 'Session complete — every focused minute counted'}
      </p>

      {phase === 'active' && (
        <div className="bg-white/3 border border-white/5 rounded-xl p-5 flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-ocean/15 flex items-center justify-center">
            <Lock size={18} className="text-ocean" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <p className="font-mono text-4xl font-bold text-blush tracking-tight">25:00</p>
            <p className="text-[10px] text-lavender/40 mt-1">Session in progress</p>
          </div>
          <div className="flex gap-8 text-center">
            <div>
              <p className="text-lg font-bold text-sage">0</p>
              <p className="text-[9px] text-lavender/40">notes taken</p>
            </div>
            <div>
              <p className="text-lg font-bold text-ocean">0</p>
              <p className="text-[9px] text-lavender/40">pages read</p>
            </div>
          </div>
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setPhase('penalty')}
              className="flex-1 py-2 rounded-xl text-xs border border-white/10 text-lavender/50 hover:border-red-400/30 hover:text-red-400/70 transition-colors"
            >
              Try to exit
            </button>
            <button
              onClick={() => setPhase('done')}
              className="flex-1 py-2 rounded-xl text-xs bg-sage/10 border border-sage/20 text-sage hover:bg-sage/20 transition-colors"
            >
              Complete session
            </button>
          </div>
        </div>
      )}

      {phase === 'penalty' && (
        <div className="bg-red-950/20 border border-red-400/20 rounded-xl p-5 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-red-400">Exit attempt detected</p>
            <p className="text-[11px] text-lavender/50 mt-0.5">Penalty added to your session time</p>
          </div>
          <div className="bg-red-500/10 border border-red-400/20 rounded-xl px-6 py-3 text-center">
            <p className="text-[9px] text-red-400/60 uppercase tracking-widest mb-0.5">Penalty</p>
            <p className="font-mono text-3xl font-bold text-red-400">+0:30</p>
          </div>
          <p className="text-[10px] text-lavender/40 text-center leading-relaxed">
            Each attempt adds more time.<br />Hold the emergency exit 3 s to force-quit.
          </p>
          <button
            onClick={() => setPhase('active')}
            className="flex items-center gap-2 px-5 py-2 bg-ocean text-white rounded-xl text-xs font-medium hover:bg-ocean/80 transition-colors"
          >
            <Lock size={12} /> Stay locked in
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div
          className="rounded-xl p-5 flex flex-col items-center gap-3 border"
          style={{ backgroundColor: '#7fbeab0d', borderColor: '#7fbeab33' }}
        >
          <div className="w-10 h-10 rounded-full bg-sage/20 flex items-center justify-center">
            <CheckCircle size={18} className="text-sage" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-sage">Session Complete!</p>
            <p className="text-[11px] text-lavender/50 mt-0.5">25 minutes of focused reading</p>
          </div>
          <div className="flex gap-8 text-center">
            <div>
              <p className="text-xl font-bold text-sage">3</p>
              <p className="text-[9px] text-lavender/40">notes taken</p>
            </div>
            <div>
              <p className="text-xl font-bold text-ocean">12</p>
              <p className="text-[9px] text-lavender/40">pages read</p>
            </div>
          </div>
          <button
            onClick={() => setPhase('active')}
            className="text-[10px] text-lavender/35 hover:text-lavender/60 transition-colors"
          >
            ↩ Try again
          </button>
        </div>
      )}
    </div>
  )
}

// ── Step 9: Finish ────────────────────────────────────────────────────────────
function FinishDemo(_props: { shared: SharedState }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 60)
    return () => clearTimeout(t)
  }, [])

  const items = [
    'Import PDFs & EPUBs into your library',
    'Drag to highlight - color coded by type',
    'Drag to select a term and create term notes',
    'Review flashcards on a 2 → 7 → 30 day schedule',
    'Auto-generate APA, MLA, or Chicago citations',
    'Map connections in the knowledge graph',
    'Look up any word\'s definition while reading',
    'Lock-in mode for distraction-free sessions',
  ]

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div
          key={item}
          className="flex items-center gap-3 bg-white/3 border border-white/5 rounded-xl px-3 py-2 transition-all"
          style={{
            transitionDuration: '350ms',
            transitionDelay: `${i * 65}ms`,
            opacity: show ? 1 : 0,
            transform: show ? 'translateX(0)' : 'translateX(-10px)',
          }}
        >
          <div className="w-4 h-4 rounded-full bg-sage/20 flex items-center justify-center shrink-0">
            <Check size={9} className="text-sage" />
          </div>
          <span className="text-[11px] text-blush/80">{item}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Tutorial ─────────────────────────────────────────────────────────────
type DemoComponent = (props: { shared: SharedState }) => JSX.Element

type StepDef = {
  title: string
  description: string
  Demo: DemoComponent
  final?: boolean
}

const STEPS: StepDef[] = [
  {
    title: 'Welcome to Aris',
    description:
      'Your personal knowledge engine for reading, annotating, and connecting ideas across your books.',
    Demo: WelcomeDemo,
  },
  {
    title: 'Highlights',
    description:
      'Pick a color in the toolbar, then click and drag across any text. Release to save the highlight instantly.',
    Demo: HighlightDemo,
  },
  {
    title: 'Notes - Term & Definition',
    description:
      'Double-click any word to open the action menu. Choose "Create note", then select the definition. Your highlight from the previous step is waiting for you.',
    Demo: NoteDemo,
  },
  {
    title: 'Flashcards',
    description:
      'Every note you save becomes a flashcard automatically. Rate your recall and Aris schedules the next review for you.',
    Demo: FlashcardDemo,
  },
  {
    title: 'Citations',
    description:
      'Add author and publication info to a book once. Aris generates formatted citations for every highlight in APA, MLA, or Chicago style.',
    Demo: CitationsDemo,
  },
  {
    title: 'Knowledge Graph',
    description:
      'Visualize how your concepts connect. Click a node to select it, then click another to draw a link between ideas.',
    Demo: KnowledgeGraphDemo,
  },
  {
    title: 'Vocab Lookup',
    description:
      'Hover any word for 3 seconds and the definition pops up automatically. Hold Ctrl while hovering for an instant result. Double-clicking works too. Add the word to your vocab notes with one click.',
    Demo: VocabLookupDemo,
  },
  {
    title: 'Lock-In Mode',
    description:
      'Commit to a focused reading session with a countdown timer. Exit attempts add penalty time — stay the course.',
    Demo: LockInDemo,
  },
  {
    title: "You're all set!",
    description:
      'Everything you need to build a rich knowledge base. Open your first book and start reading.',
    Demo: FinishDemo,
    final: true,
  },
]

interface Props {
  onDismiss: () => void
}

export default function Tutorial({ onDismiss }: Props) {
  const [step, setStep] = useState(0)

  const [hlState, setHlState] = useState<{
    text: string; range: [number, number] | null; typeId: string
  }>({ text: '', range: null, typeId: 'blue' })
  const [savedNote, setSavedNote] = useState<{ term: string; definition: string } | null>(null)

  const shared: SharedState = {
    hlText: hlState.text,
    hlRange: hlState.range,
    hlTypeId: hlState.typeId,
    onHighlight: (text, s, e, typeId) => setHlState({ text, range: [s, e], typeId }),
    savedNote,
    onSaveNote: (term, definition) => setSavedNote({ term, definition }),
  }

  const isLast = step === STEPS.length - 1
  const { title, description, Demo, final: isFinal } = STEPS[step]

  const advance = () => {
    if (isLast) onDismiss()
    else setStep((s) => s + 1)
  }

  return (
    <div className="fixed inset-0 z-[400] flex items-center justify-center bg-ink/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl mx-4 bg-[#1e2535] rounded-2xl border border-white/8 shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">

        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 z-10 text-lavender/35 hover:text-lavender/70 transition-colors"
          aria-label="Skip tutorial"
        >
          <X size={17} />
        </button>

        <div className="px-6 pt-6 pb-4 shrink-0">
          <h2 className="font-serif text-xl text-blush pr-6 leading-snug">{title}</h2>
          <p className="text-xs text-lavender/55 mt-1.5 leading-relaxed">{description}</p>
        </div>

        <div className="px-6 pb-2 flex-1 overflow-y-auto min-h-0">
          <Demo shared={shared} />
        </div>

        <div className="px-6 py-4 shrink-0 flex items-center justify-between border-t border-white/5">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Step ${i + 1}`}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === step ? 20 : 6,
                  height: 6,
                  backgroundColor: i === step ? '#2978a0' : 'rgba(255,255,255,0.12)',
                }}
              />
            ))}
          </div>

          <button
            onClick={advance}
            className="flex items-center gap-1.5 px-5 py-2 bg-ocean text-white rounded-xl text-sm font-medium hover:bg-ocean/90 active:scale-95 transition-all"
          >
            {isFinal ? 'Get Started' : 'Next'}
            {!isFinal && <ChevronRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}
