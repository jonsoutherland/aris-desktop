import { useState, useEffect, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Target, Calendar, Clock, BookOpen, Bell, Trash2, ChevronDown, RefreshCw, Plus, X } from 'lucide-react'
import { useStore } from '../store'
import type { ChapterDeadline, OutlineItem } from '../types'
import { clsx } from 'clsx'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const WORDS_PER_MINUTE = 250
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function toDateInputValue(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function fromDateInputValue(val: string): number {
  return new Date(val + 'T23:59:59').getTime()
}

function daysUntil(ts: number): number {
  return Math.max(0, Math.ceil((ts - Date.now()) / 86400000))
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

// Sample up to 20 evenly-distributed pages and return median words/page + total estimate
async function estimateWordCount(
  filePath: string,
  totalPages: number,
  onProgress: (pct: number) => void,
  signal: { cancelled: boolean }
): Promise<{ wordsPerPage: number; totalWords: number }> {
  const url = filePath.startsWith('file://') ? filePath : `file://${filePath}`
  const pdf = await pdfjsLib.getDocument({ url }).promise
  if (signal.cancelled) { pdf.destroy(); throw new Error('cancelled') }

  const sampleCount = Math.min(20, totalPages)
  const step = Math.max(1, Math.floor(totalPages / sampleCount))
  const pageCounts: number[] = []

  try {
    for (let i = 0; i < sampleCount; i++) {
      if (signal.cancelled) break
      const pageNum = Math.min(i * step + 1, totalPages)
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
      const words = text.trim().split(/\s+/).filter(Boolean).length
      pageCounts.push(words)
      onProgress(Math.round(((i + 1) / sampleCount) * 100))
    }
  } finally {
    try { pdf.destroy() } catch {}
  }

  if (signal.cancelled || pageCounts.length === 0) throw new Error('cancelled')

  pageCounts.sort((a, b) => a - b)
  const mid = Math.floor(pageCounts.length / 2)
  const median =
    pageCounts.length % 2 === 0
      ? (pageCounts[mid - 1] + pageCounts[mid]) / 2
      : pageCounts[mid]

  return { wordsPerPage: Math.round(median), totalWords: Math.round(median * totalPages) }
}

interface ChapterRow {
  outlineItem: OutlineItem
  finishBy: string // date input value
}

export default function ReadingGoals() {
  const {
    sources,
    activeSourceId,
    outline,
    loadOutline,
    readingGoal,
    chapterDeadlines,
    loadReadingGoal,
    saveReadingGoal,
    deleteReadingGoal,
    saveChapterDeadlines,
  } = useStore()

  // Which source we're configuring
  const [selectedSourceId, setSelectedSourceId] = useState<string>(activeSourceId ?? '')
  const source = sources.find((s) => s.id === selectedSourceId) ?? null

  // Goal form state
  const [finishBy, setFinishBy] = useState('')
  const [reminderFreq, setReminderFreq] = useState<'daily' | 'weekly' | ''>('')
  const [reminderDay, setReminderDay] = useState<number>(1)
  const [reminderTime, setReminderTime] = useState('09:00')

  // Word count estimation
  const [estimating, setEstimating] = useState(false)
  const [estimateProgress, setEstimateProgress] = useState(0)
  const [wordsPerPage, setWordsPerPage] = useState<number | null>(null)
  const [totalWords, setTotalWords] = useState<number | null>(null)
  const estimateSignal = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Chapter deadlines (only top-level outline items)
  const topLevelChapters = outline.filter((o) => o.depth === 0 || o.parent_id === null)
  const [chapterRows, setChapterRows] = useState<ChapterRow[]>([])
  const [showChapters, setShowChapters] = useState(false)

  // Custom chapter (manual entry when no outline)
  const [customChapters, setCustomChapters] = useState<{ name: string; finishBy: string }[]>([])

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Cancel any in-flight estimation when source changes or component unmounts
  useEffect(() => {
    return () => { estimateSignal.current.cancelled = true }
  }, [selectedSourceId])

  // Load goal & outline when source changes
  useEffect(() => {
    if (!selectedSourceId) return
    setEstimating(false)
    loadReadingGoal(selectedSourceId)
    loadOutline(selectedSourceId)
  }, [selectedSourceId])

  // Populate form from existing goal
  useEffect(() => {
    if (readingGoal && readingGoal.source_id === selectedSourceId) {
      setFinishBy(toDateInputValue(readingGoal.finish_by))
      setReminderFreq(readingGoal.reminder_frequency ?? '')
      setReminderDay(readingGoal.reminder_day ?? 1)
      setReminderTime(readingGoal.reminder_time ?? '09:00')
      if (readingGoal.words_per_page) setWordsPerPage(readingGoal.words_per_page)
      if (readingGoal.estimated_word_count) setTotalWords(readingGoal.estimated_word_count)
    } else {
      setFinishBy('')
      setReminderFreq('')
      setReminderDay(1)
      setReminderTime('09:00')
      setWordsPerPage(null)
      setTotalWords(null)
    }
  }, [readingGoal, selectedSourceId])

  // Populate chapter rows from outline + saved deadlines
  useEffect(() => {
    if (topLevelChapters.length === 0) return
    setChapterRows(
      topLevelChapters.map((ch) => {
        const saved = chapterDeadlines.find((d) => d.outline_item_id === ch.id)
        return { outlineItem: ch, finishBy: saved ? toDateInputValue(saved.finish_by) : '' }
      })
    )
  }, [outline, chapterDeadlines])

  // Populate custom chapters when no outline but deadlines exist
  useEffect(() => {
    if (topLevelChapters.length > 0) return
    const customs = chapterDeadlines.filter((d) => !d.outline_item_id)
    if (customs.length > 0) {
      setCustomChapters(
        customs.map((d) => ({ name: d.chapter_name, finishBy: toDateInputValue(d.finish_by) }))
      )
    }
  }, [chapterDeadlines])

  const handleEstimate = useCallback(async () => {
    if (!source?.file_path || !source.total_pages) return
    estimateSignal.current.cancelled = true
    const signal = { cancelled: false }
    estimateSignal.current = signal
    setEstimating(true)
    setEstimateProgress(0)
    try {
      const result = await estimateWordCount(source.file_path, source.total_pages, setEstimateProgress, signal)
      if (!signal.cancelled) {
        setWordsPerPage(result.wordsPerPage)
        setTotalWords(result.totalWords)
      }
    } catch {
      // cancelled or pdfjs error — leave existing values intact
    } finally {
      if (!signal.cancelled) setEstimating(false)
    }
  }, [source])

  const handleSave = async () => {
    if (!selectedSourceId || !finishBy) return
    setSaving(true)
    try {
      await saveReadingGoal(selectedSourceId, fromDateInputValue(finishBy), {
        reminderFrequency: reminderFreq || null,
        reminderDay: reminderFreq === 'weekly' ? reminderDay : null,
        reminderTime: reminderFreq ? reminderTime : null,
        estimatedWordCount: totalWords,
        wordsPerPage,
      })

      // Save chapter deadlines
      const goal = useStore.getState().readingGoal
      if (goal) {
        const outlineDeadlines: Omit<ChapterDeadline, 'id' | 'goal_id'>[] = chapterRows
          .filter((r) => r.finishBy)
          .map((r) => ({
            outline_item_id: r.outlineItem.id,
            chapter_name: r.outlineItem.title,
            finish_by: fromDateInputValue(r.finishBy),
          }))

        const customDeadlines: Omit<ChapterDeadline, 'id' | 'goal_id'>[] = customChapters
          .filter((c) => c.name.trim() && c.finishBy)
          .map((c) => ({
            outline_item_id: null,
            chapter_name: c.name.trim(),
            finish_by: fromDateInputValue(c.finishBy),
          }))

        await saveChapterDeadlines(goal.id, [...outlineDeadlines, ...customDeadlines])
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  // ── Derived reading plan numbers ───────────────────────────────────────────
  const daysLeft = finishBy ? daysUntil(fromDateInputValue(finishBy)) : null
  const totalPages = source?.total_pages ?? null
  const currentPage = source?.current_page ?? 1
  const pagesLeft = totalPages ? Math.max(0, totalPages - currentPage + 1) : null
  const pagesPerDay =
    daysLeft && daysLeft > 0 && pagesLeft != null
      ? Math.ceil(pagesLeft / daysLeft)
      : null
  const minutesPerDay =
    pagesPerDay && wordsPerPage
      ? Math.round((pagesPerDay * wordsPerPage) / WORDS_PER_MINUTE)
      : null
  const totalMinutes =
    totalWords ? Math.round(totalWords / WORDS_PER_MINUTE) : null

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush">Reading Goals</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl space-y-8">

          {/* Source selector */}
          <section>
            <label className="block text-xs text-lavender/50 mb-2 uppercase tracking-wider">Book</label>
            <div className="relative">
              <select
                value={selectedSourceId}
                onChange={(e) => setSelectedSourceId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-blush appearance-none outline-none focus:border-ocean/50 pr-10"
              >
                <option value="">— Select a book —</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id} className="bg-ink">
                    {s.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-lavender/40 pointer-events-none" />
            </div>
            {source && (
              <p className="mt-1.5 text-xs text-lavender/40">
                {source.total_pages ? `${source.total_pages} pages` : 'Unknown length'} ·{' '}
                Currently on page {source.current_page}
              </p>
            )}
          </section>

          {selectedSourceId && (
            <>
              {/* Finish by date */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar size={15} className="text-ocean" />
                  <h2 className="font-serif text-lg text-blush">Finish By</h2>
                </div>
                <input
                  type="date"
                  value={finishBy}
                  min={today}
                  onChange={(e) => setFinishBy(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-blush outline-none focus:border-ocean/50 w-full sm:w-auto"
                />
                {daysLeft !== null && (
                  <p className="mt-2 text-xs text-lavender/50">
                    {daysLeft === 0 ? 'Due today' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''} from now`}
                  </p>
                )}
              </section>

              {/* Word count estimation */}
              {source?.type === 'pdf' && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen size={15} className="text-ocean" />
                    <h2 className="font-serif text-lg text-blush">Word Count Estimate</h2>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                    {wordsPerPage !== null && totalWords !== null ? (
                      <div className="space-y-1 mb-4">
                        <p className="text-sm text-blush font-medium">
                          ~{totalWords.toLocaleString()} words
                        </p>
                        <p className="text-xs text-lavender/40">
                          ~{wordsPerPage} words/page × {totalPages?.toLocaleString()} pages
                          {totalMinutes !== null && (
                            <> · ~{fmtHours(totalMinutes)} total reading time</>
                          )}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-lavender/40 mb-4">
                        Sample {Math.min(20, source.total_pages ?? 20)} pages to estimate total
                        reading time.
                      </p>
                    )}

                    {estimating ? (
                      <div className="space-y-2">
                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-ocean rounded-full transition-all duration-200"
                            style={{ width: `${estimateProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-lavender/40">Sampling pages… {estimateProgress}%</p>
                      </div>
                    ) : (
                      <button
                        onClick={handleEstimate}
                        disabled={!source.total_pages}
                        className="flex items-center gap-2 text-xs text-ocean hover:text-ocean/70 transition-colors disabled:opacity-40"
                      >
                        <RefreshCw size={12} />
                        {wordsPerPage !== null ? 'Recalculate' : 'Calculate estimate'}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Reading plan */}
              {finishBy && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Target size={15} className="text-ocean" />
                    <h2 className="font-serif text-lg text-blush">Your Reading Plan</h2>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: 'Days left', value: daysLeft !== null ? String(daysLeft) : '—' },
                      {
                        label: 'Pages / day',
                        value: pagesPerDay != null ? String(pagesPerDay) : '—',
                      },
                      {
                        label: 'Time / day',
                        value: minutesPerDay != null ? fmtHours(minutesPerDay) : '—',
                      },
                      {
                        label: 'Pages left',
                        value: pagesLeft != null ? String(pagesLeft) : '—',
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="bg-white/5 border border-white/10 rounded-xl p-4 text-center"
                      >
                        <p className="text-xl font-bold text-ocean">{value}</p>
                        <p className="text-[11px] text-lavender/50 mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  {minutesPerDay === null && wordsPerPage === null && source?.type === 'pdf' && (
                    <p className="mt-2 text-xs text-lavender/30">
                      Calculate a word count estimate above to see daily reading time.
                    </p>
                  )}
                </section>
              )}

              {/* Chapter deadlines */}
              <section>
                <button
                  onClick={() => setShowChapters((v) => !v)}
                  className="flex items-center gap-2 mb-3 group"
                >
                  <Clock size={15} className="text-ocean" />
                  <h2 className="font-serif text-lg text-blush group-hover:text-ocean transition-colors">
                    Chapter Deadlines
                    <span className="text-lavender/40 font-sans text-xs ml-2 font-normal">optional</span>
                  </h2>
                  <ChevronDown
                    size={14}
                    className={clsx(
                      'text-lavender/40 transition-transform ml-1',
                      showChapters && 'rotate-180'
                    )}
                  />
                </button>

                {showChapters && (
                  <div className="space-y-2">
                    {topLevelChapters.length > 0 ? (
                      <>
                        <p className="text-xs text-lavender/40 mb-3">
                          Set optional deadlines for each chapter. Leave blank to skip.
                        </p>
                        {chapterRows.map((row, i) => (
                          <div
                            key={row.outlineItem.id}
                            className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-blush truncate">{row.outlineItem.title}</p>
                              <p className="text-[11px] text-lavender/40">
                                p. {row.outlineItem.page_number}
                                {row.finishBy && (() => {
                                  const d = daysUntil(fromDateInputValue(row.finishBy))
                                  const isPast = fromDateInputValue(row.finishBy) < Date.now()
                                  return (
                                    <span
                                      className={clsx(
                                        'ml-2',
                                        isPast ? 'text-red-400' : 'text-sage'
                                      )}
                                    >
                                      {isPast ? 'overdue' : `${d}d left`}
                                    </span>
                                  )
                                })()}
                              </p>
                            </div>
                            <input
                              type="date"
                              value={row.finishBy}
                              min={today}
                              onChange={(e) => {
                                const next = [...chapterRows]
                                next[i] = { ...row, finishBy: e.target.value }
                                setChapterRows(next)
                              }}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blush outline-none focus:border-ocean/50 w-36"
                            />
                          </div>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-lavender/40 mb-3">
                          No outline detected. Add chapters manually.
                        </p>
                        {customChapters.map((ch, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3"
                          >
                            <input
                              type="text"
                              placeholder="Chapter name"
                              value={ch.name}
                              onChange={(e) => {
                                const next = [...customChapters]
                                next[i] = { ...ch, name: e.target.value }
                                setCustomChapters(next)
                              }}
                              className="flex-1 bg-transparent text-sm text-blush outline-none placeholder:text-lavender/30"
                            />
                            <input
                              type="date"
                              value={ch.finishBy}
                              min={today}
                              onChange={(e) => {
                                const next = [...customChapters]
                                next[i] = { ...ch, finishBy: e.target.value }
                                setCustomChapters(next)
                              }}
                              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blush outline-none focus:border-ocean/50 w-36"
                            />
                            <button
                              onClick={() =>
                                setCustomChapters(customChapters.filter((_, j) => j !== i))
                              }
                              className="text-lavender/30 hover:text-red-400 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => setCustomChapters([...customChapters, { name: '', finishBy: '' }])}
                          className="flex items-center gap-1.5 text-xs text-lavender/40 hover:text-ocean transition-colors mt-1"
                        >
                          <Plus size={12} />
                          Add chapter
                        </button>
                      </>
                    )}
                  </div>
                )}
              </section>

              {/* Reminders */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Bell size={15} className="text-ocean" />
                  <h2 className="font-serif text-lg text-blush">Reminders</h2>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-xs text-lavender/50 w-20 shrink-0">Frequency</label>
                    <div className="flex gap-2">
                      {(['', 'daily', 'weekly'] as const).map((f) => (
                        <button
                          key={f}
                          onClick={() => setReminderFreq(f)}
                          className={clsx(
                            'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                            reminderFreq === f
                              ? 'bg-ocean text-white'
                              : 'bg-white/5 text-lavender/50 hover:text-blush hover:bg-white/10'
                          )}
                        >
                          {f === '' ? 'None' : f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {reminderFreq === 'weekly' && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="text-xs text-lavender/50 w-20 shrink-0">Day</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAY_NAMES.map((name, idx) => (
                          <button
                            key={idx}
                            onClick={() => setReminderDay(idx)}
                            className={clsx(
                              'px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                              reminderDay === idx
                                ? 'bg-ocean text-white'
                                : 'bg-white/5 text-lavender/50 hover:text-blush hover:bg-white/10'
                            )}
                          >
                            {name.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {reminderFreq !== '' && (
                    <div className="flex items-center gap-3">
                      <label className="text-xs text-lavender/50 w-20 shrink-0">Time</label>
                      <input
                        type="time"
                        value={reminderTime}
                        onChange={(e) => setReminderTime(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-blush outline-none focus:border-ocean/50"
                      />
                    </div>
                  )}

                  {reminderFreq !== '' && (
                    <p className="text-xs text-lavender/30">
                      You'll receive a reminder{' '}
                      {reminderFreq === 'daily'
                        ? `daily at ${reminderTime}`
                        : `every ${DAY_NAMES[reminderDay]} at ${reminderTime}`}{' '}
                      when Aris is open.
                    </p>
                  )}
                </div>
              </section>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleSave}
                  disabled={!finishBy || saving}
                  className="flex items-center gap-2 bg-ocean text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-ocean/80 transition-colors disabled:opacity-40"
                >
                  {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Goal'}
                </button>
                {readingGoal && readingGoal.source_id === selectedSourceId && (
                  <button
                    onClick={() => deleteReadingGoal(selectedSourceId)}
                    className="flex items-center gap-2 text-sm text-lavender/40 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                    Remove goal
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
