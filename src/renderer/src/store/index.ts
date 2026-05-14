import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import { titleFromFilePath } from '../lib/title'
import type {
  KnowledgeSource,
  KnowledgeGraph,
  HighlightType,
  Highlight,
  Note,
  NoteLink,
  NodePosition,
  FlashcardState,
  View,
  HighlightRect,
  IntervalStage,
  OutlineItem,
  ReadingGoal,
  ChapterDeadline,
} from '../types'

declare global {
  interface Window {
    api: {
      openFile: () => Promise<string | null>
      openPath: (path: string) => Promise<void>
      db: {
        run: (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
        all: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>
        get: <T = unknown>(sql: string, params?: unknown[]) => Promise<T | undefined>
      }
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        setFullscreen: (val: boolean) => Promise<void>
        setLockIn: (active: boolean) => Promise<void>
        allowExit: () => Promise<void>
        onExitAttempt: (cb: () => void) => void
        offExitAttempt: () => void
      }
    }
  }
}

const INTERVAL_DAYS: Record<IntervalStage, number> = {
  0: 0,
  1: 2,
  2: 7,
  3: 30,
}

function daysFromNow(days: number): number {
  return Date.now() + days * 86400000
}

interface AppState {
  // Navigation
  view: View
  activeSourceId: string | null

  // Data
  sources: KnowledgeSource[]
  highlightTypes: HighlightType[]
  highlights: Highlight[]
  notes: Note[]
  noteLinks: NoteLink[]
  nodePositions: NodePosition[]
  flashcardStates: FlashcardState[]
  outline: OutlineItem[]

  // Reader state
  activePage: number
  activeHighlightTypeId: string | null

  // Actions
  setView: (view: View) => void
  setActiveSource: (id: string | null) => void
  setActivePage: (page: number) => void
  setActiveHighlightTypeId: (id: string | null) => void

  loadSources: () => Promise<void>
  addSource: (filePath: string, titleOverride?: string) => Promise<KnowledgeSource | null>
  deleteSource: (id: string) => Promise<void>
  updateSourcePage: (id: string, page: number, scrollFraction?: number) => Promise<void>
  saveEpubPosition: (id: string, chapter: number, cfi: string) => Promise<void>
  saveCoverImage: (id: string, dataUrl: string) => Promise<void>

  updateSourceMetadata: (
    id: string,
    metadata: { author?: string; publication_year?: number | null; publisher?: string; edition?: string }
  ) => Promise<void>

  loadHighlightTypes: () => Promise<void>
  addHighlightType: (name: string, color: string, description?: string) => Promise<void>
  updateHighlightType: (id: string, name: string, color: string, description?: string) => Promise<void>
  deleteHighlightType: (id: string) => Promise<void>

  loadHighlights: (sourceId: string) => Promise<void>
  addHighlight: (
    sourceId: string,
    page: number,
    text: string,
    rects: HighlightRect[],
    typeId?: string,
    cfi?: string,
  ) => Promise<Highlight>
  deleteHighlight: (id: string) => Promise<void>

  loadNotes: (sourceId?: string) => Promise<void>
  addNote: (
    sourceId: string,
    term: string,
    definition: string,
    opts?: { highlightId?: string; chapter?: string; page?: number; outlineItemId?: string }
  ) => Promise<Note>

  loadOutline: (sourceId: string) => Promise<void>
  saveOutline: (sourceId: string, items: OutlineItem[]) => Promise<void>
  updateNote: (id: string, term: string, definition: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>

  loadNoteLinks: () => Promise<void>
  addNoteLink: (fromId: string, toId: string, relationship?: string) => Promise<void>
  deleteNoteLink: (fromId: string, toId: string) => Promise<void>

  loadNodePositions: () => Promise<void>
  saveNodePosition: (noteId: string, x: number, y: number) => Promise<void>

  // Knowledge graphs
  graphs: KnowledgeGraph[]
  activeGraphId: string | null
  loadGraphs: () => Promise<void>
  createGraph: (name: string) => Promise<KnowledgeGraph>
  renameGraph: (id: string, name: string) => Promise<void>
  deleteGraph: (id: string) => Promise<void>
  setActiveGraph: (id: string) => void

  loadFlashcardStates: () => Promise<void>
  recordFlashcardResult: (noteId: string, correct: boolean) => Promise<void>

  getSourceTags: (sourceId: string) => Promise<string[]>
  getAllTags: () => Promise<string[]>
  addSourceTag: (sourceId: string, tag: string) => Promise<void>
  removeSourceTag: (sourceId: string, tag: string) => Promise<void>

  // Lock-in mode
  lockInPhase: 'idle' | 'active' | 'penalty' | 'complete'
  lockInSetupOpen: boolean
  lockInDurationMs: number
  lockInStartTime: number
  lockInPenaltyMs: number
  lockInPenaltyEndTime: number | null
  lockInExitCount: number
  lockInStartPage: number
  lockInStartNoteCount: number

  startLockIn: (durationMs: number) => void
  triggerLockInExit: () => void
  penaltyComplete: () => void
  completeLockIn: () => void
  resetLockIn: () => void
  setLockInSetupOpen: (open: boolean) => void

  addVocabWord: (word: string, definition: string) => Promise<void>

  // Reading goals
  readingGoal: ReadingGoal | null
  chapterDeadlines: ChapterDeadline[]
  loadReadingGoal: (sourceId: string) => Promise<void>
  saveReadingGoal: (
    sourceId: string,
    finishBy: number,
    opts?: {
      reminderFrequency?: 'daily' | 'weekly' | null
      reminderDay?: number | null
      reminderTime?: string | null
      estimatedWordCount?: number | null
      wordsPerPage?: number | null
    }
  ) => Promise<void>
  deleteReadingGoal: (sourceId: string) => Promise<void>
  loadChapterDeadlines: (goalId: string) => Promise<void>
  saveChapterDeadlines: (
    goalId: string,
    deadlines: Omit<ChapterDeadline, 'id' | 'goal_id'>[]
  ) => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  view: 'library',
  activeSourceId: null,
  sources: [],
  highlightTypes: [],
  highlights: [],
  notes: [],
  noteLinks: [],
  nodePositions: [],
  flashcardStates: [],
  outline: [],
  activePage: 1,
  activeHighlightTypeId: null,
  readingGoal: null,
  chapterDeadlines: [],
  graphs: [],
  activeGraphId: null,
  lockInPhase: 'idle',
  lockInSetupOpen: false,
  lockInDurationMs: 0,
  lockInStartTime: 0,
  lockInPenaltyMs: 5000,
  lockInPenaltyEndTime: null,
  lockInExitCount: 0,
  lockInStartPage: 1,
  lockInStartNoteCount: 0,

  setView: (view) => set({ view }),
  setActiveSource: (id) => set({ activeSourceId: id, activePage: 1 }),
  setActivePage: (page) => set({ activePage: page }),
  setActiveHighlightTypeId: (id) => set({ activeHighlightTypeId: id }),

  // ── Sources ────────────────────────────────────────────────────────────────

  loadSources: async () => {
    const sources = await window.api.db.all<KnowledgeSource>(
      'SELECT * FROM knowledge_sources ORDER BY last_opened DESC, created_at DESC'
    )
    set({ sources })
  },

  addSource: async (filePath, titleOverride) => {
    const ext = filePath.split('.').pop()?.toLowerCase()
    if (ext !== 'pdf' && ext !== 'epub') return null
    const title = titleOverride?.trim() || titleFromFilePath(filePath)
    const id = uuidv4()
    const now = Date.now()
    await window.api.db.run(
      'INSERT INTO knowledge_sources (id, title, type, file_path, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, title, ext, filePath, now]
    )
    await get().loadSources()
    return get().sources.find((s) => s.id === id) ?? null
  },

  deleteSource: async (id) => {
    await window.api.db.run('DELETE FROM knowledge_sources WHERE id = ?', [id])
    await get().loadSources()
    if (get().activeSourceId === id) set({ activeSourceId: null, view: 'library' })
  },

  updateSourcePage: async (id, page, scrollFraction) => {
    await window.api.db.run(
      'UPDATE knowledge_sources SET current_page = ?, last_opened = ?, scroll_fraction = ? WHERE id = ?',
      [page, Date.now(), scrollFraction ?? 0, id]
    )
    set((state) => ({
      sources: state.sources.map((s) =>
        s.id === id
          ? { ...s, current_page: page, scroll_fraction: scrollFraction ?? s.scroll_fraction ?? 0 }
          : s
      ),
    }))
  },

  saveEpubPosition: async (id, chapter, cfi) => {
    await window.api.db.run(
      'UPDATE knowledge_sources SET current_page = ?, epub_cfi = ?, last_opened = ? WHERE id = ?',
      [chapter, cfi, Date.now(), id]
    )
    set((state) => ({
      sources: state.sources.map((s) =>
        s.id === id ? { ...s, current_page: chapter, epub_cfi: cfi } : s
      ),
    }))
  },

  saveCoverImage: async (id, dataUrl) => {
    await window.api.db.run(
      'UPDATE knowledge_sources SET cover_image = ? WHERE id = ?',
      [dataUrl, id]
    )
    set((state) => ({
      sources: state.sources.map((s) =>
        s.id === id ? { ...s, cover_image: dataUrl } : s
      ),
    }))
  },

  updateSourceMetadata: async (id, metadata) => {
    await window.api.db.run(
      'UPDATE knowledge_sources SET author = ?, publication_year = ?, publisher = ?, edition = ? WHERE id = ?',
      [metadata.author ?? null, metadata.publication_year ?? null, metadata.publisher ?? null, metadata.edition ?? null, id]
    )
    await get().loadSources()
  },

  // ── Highlight types ────────────────────────────────────────────────────────

  loadHighlightTypes: async () => {
    const highlightTypes = await window.api.db.all<HighlightType>(
      'SELECT * FROM highlight_types ORDER BY name'
    )
    const activeId = get().activeHighlightTypeId
    set({
      highlightTypes,
      activeHighlightTypeId: activeId ?? highlightTypes[0]?.id ?? null,
    })
  },

  addHighlightType: async (name, color, description) => {
    const id = uuidv4()
    await window.api.db.run(
      'INSERT INTO highlight_types (id, name, color, description) VALUES (?, ?, ?, ?)',
      [id, name, color, description ?? null]
    )
    await get().loadHighlightTypes()
  },

  updateHighlightType: async (id, name, color, description) => {
    await window.api.db.run(
      'UPDATE highlight_types SET name = ?, color = ?, description = ? WHERE id = ?',
      [name, color, description ?? null, id]
    )
    await get().loadHighlightTypes()
  },

  deleteHighlightType: async (id) => {
    await window.api.db.run('DELETE FROM highlight_types WHERE id = ?', [id])
    await get().loadHighlightTypes()
  },

  // ── Highlights ─────────────────────────────────────────────────────────────

  loadHighlights: async (sourceId) => {
    const rows = await window.api.db.all<Omit<Highlight, 'rects'> & { rects: string }>(
      'SELECT h.*, ht.name as ht_name, ht.color as ht_color FROM highlights h LEFT JOIN highlight_types ht ON h.highlight_type_id = ht.id WHERE h.source_id = ?',
      [sourceId]
    )
    const highlights: Highlight[] = rows.map((r) => ({
      ...r,
      rects: JSON.parse(r.rects),
      highlight_type: r.highlight_type_id
        ? { id: r.highlight_type_id, name: (r as unknown as { ht_name: string }).ht_name, color: (r as unknown as { ht_color: string }).ht_color, description: null }
        : undefined,
    }))
    set({ highlights })
  },

  addHighlight: async (sourceId, page, text, rects, typeId, cfi) => {
    const id = uuidv4()
    const now = Date.now()
    const activeTypeId = typeId ?? get().activeHighlightTypeId
    await window.api.db.run(
      'INSERT INTO highlights (id, source_id, page_number, highlight_type_id, selected_text, rects, cfi, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, sourceId, page, activeTypeId ?? null, text, JSON.stringify(rects), cfi ?? null, now]
    )
    await get().loadHighlights(sourceId)
    return get().highlights.find((h) => h.id === id)!
  },

  deleteHighlight: async (id) => {
    const sourceId = get().highlights.find((h) => h.id === id)?.source_id
    await window.api.db.run('DELETE FROM highlights WHERE id = ?', [id])
    if (sourceId) await get().loadHighlights(sourceId)
  },

  // ── Notes ──────────────────────────────────────────────────────────────────

  loadNotes: async (sourceId) => {
    const sql = sourceId
      ? 'SELECT * FROM notes WHERE source_id = ? ORDER BY page_number, created_at'
      : 'SELECT * FROM notes ORDER BY page_number, created_at'
    const params = sourceId ? [sourceId] : []
    const notes = await window.api.db.all<Note>(sql, params)
    set({ notes })
  },

  addNote: async (sourceId, term, definition, opts = {}) => {
    const id = uuidv4()
    const now = Date.now()
    await window.api.db.run(
      'INSERT INTO notes (id, source_id, highlight_id, term, definition, chapter, page_number, outline_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, sourceId, opts.highlightId ?? null, term, definition, opts.chapter ?? null, opts.page ?? null, opts.outlineItemId ?? null, now]
    )
    // Create initial flashcard state
    await window.api.db.run(
      'INSERT INTO flashcard_state (note_id, next_review, interval_stage, consecutive_correct) VALUES (?, ?, 0, 0)',
      [id, now]
    )
    await get().loadNotes(sourceId)
    await get().loadFlashcardStates()
    return get().notes.find((n) => n.id === id)!
  },

  addVocabWord: async (word, definition) => {
    let vocabSource = await window.api.db.get<{ id: string }>(
      "SELECT id FROM knowledge_sources WHERE type = 'vocab' LIMIT 1"
    )
    if (!vocabSource) {
      const id = uuidv4()
      const now = Date.now()
      await window.api.db.run(
        "INSERT INTO knowledge_sources (id, title, type, file_path, created_at) VALUES (?, 'Vocabulary', 'vocab', '__vocab__', ?)",
        [id, now]
      )
      vocabSource = { id }
      // Don't loadSources() here — Library filters vocab anyway and we don't want to
      // trigger an unnecessary re-render in the middle of a reader session.
    }
    const noteId = uuidv4()
    const now = Date.now()
    await window.api.db.run(
      'INSERT INTO notes (id, source_id, highlight_id, term, definition, chapter, page_number, outline_item_id, created_at) VALUES (?, ?, NULL, ?, ?, NULL, NULL, NULL, ?)',
      [noteId, vocabSource.id, word, definition, now]
    )
    await window.api.db.run(
      'INSERT INTO flashcard_state (note_id, next_review, interval_stage, consecutive_correct) VALUES (?, ?, 0, 0)',
      [noteId, now]
    )
    // Only reload flashcard states — avoids overwriting the active source's notes array
    await get().loadFlashcardStates()
  },

  updateNote: async (id, term, definition) => {
    await window.api.db.run(
      'UPDATE notes SET term = ?, definition = ? WHERE id = ?',
      [term, definition, id]
    )
    const note = get().notes.find((n) => n.id === id)
    if (note) await get().loadNotes(note.source_id)
  },

  deleteNote: async (id) => {
    const note = get().notes.find((n) => n.id === id)
    await window.api.db.run('DELETE FROM flashcard_state WHERE note_id = ?', [id])
    await window.api.db.run('DELETE FROM notes WHERE id = ?', [id])
    if (note) await get().loadNotes(note.source_id)
    await get().loadFlashcardStates()
  },

  // ── Outline ────────────────────────────────────────────────────────────────

  loadOutline: async (sourceId) => {
    const outline = await window.api.db.all<OutlineItem>(
      'SELECT * FROM source_outline_items WHERE source_id = ? ORDER BY sort_order',
      [sourceId]
    )
    set({ outline })
  },

  saveOutline: async (sourceId, items) => {
    await window.api.db.run('DELETE FROM source_outline_items WHERE source_id = ?', [sourceId])
    for (const it of items) {
      await window.api.db.run(
        'INSERT INTO source_outline_items (id, source_id, parent_id, title, page_number, sort_order, depth, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [it.id, it.source_id, it.parent_id, it.title, it.page_number, it.sort_order, it.depth, it.origin]
      )
    }
    set({ outline: items })
  },

  // ── Knowledge graphs ───────────────────────────────────────────────────────

  loadGraphs: async () => {
    const graphs = await window.api.db.all<KnowledgeGraph>(
      'SELECT * FROM knowledge_graphs ORDER BY created_at'
    )
    set({ graphs })
    if (graphs.length > 0 && !get().activeGraphId) {
      set({ activeGraphId: graphs[0].id })
    }
  },

  createGraph: async (name) => {
    const id = uuidv4()
    const now = Date.now()
    await window.api.db.run(
      'INSERT INTO knowledge_graphs (id, name, created_at) VALUES (?, ?, ?)',
      [id, name, now]
    )
    const graph: KnowledgeGraph = { id, name, created_at: now }
    set((state) => ({ graphs: [...state.graphs, graph] }))
    return graph
  },

  renameGraph: async (id, name) => {
    await window.api.db.run('UPDATE knowledge_graphs SET name = ? WHERE id = ?', [name, id])
    set((state) => ({
      graphs: state.graphs.map((g) => (g.id === id ? { ...g, name } : g)),
    }))
  },

  deleteGraph: async (id) => {
    const { graphs, activeGraphId } = get()
    if (graphs.length <= 1) return
    await window.api.db.run('DELETE FROM knowledge_graphs WHERE id = ?', [id])
    const remaining = graphs.filter((g) => g.id !== id)
    set({ graphs: remaining })
    if (activeGraphId === id) {
      get().setActiveGraph(remaining[0].id)
    }
  },

  setActiveGraph: (id) => {
    set({ activeGraphId: id, noteLinks: [], nodePositions: [] })
  },

  // ── Note links ─────────────────────────────────────────────────────────────

  loadNoteLinks: async () => {
    const graphId = get().activeGraphId
    if (!graphId) return
    const noteLinks = await window.api.db.all<NoteLink>(
      'SELECT * FROM note_links WHERE graph_id = ?',
      [graphId]
    )
    set({ noteLinks })
  },

  addNoteLink: async (fromId, toId, relationship) => {
    const graphId = get().activeGraphId
    if (!graphId) return
    await window.api.db.run(
      'INSERT OR IGNORE INTO note_links (graph_id, from_note_id, to_note_id, relationship) VALUES (?, ?, ?, ?)',
      [graphId, fromId, toId, relationship ?? null]
    )
    await get().loadNoteLinks()
  },

  deleteNoteLink: async (fromId, toId) => {
    const graphId = get().activeGraphId
    if (!graphId) return
    await window.api.db.run(
      'DELETE FROM note_links WHERE graph_id = ? AND from_note_id = ? AND to_note_id = ?',
      [graphId, fromId, toId]
    )
    await get().loadNoteLinks()
  },

  // ── Node positions ─────────────────────────────────────────────────────────

  loadNodePositions: async () => {
    const graphId = get().activeGraphId
    if (!graphId) return
    const nodePositions = await window.api.db.all<NodePosition>(
      'SELECT * FROM node_positions WHERE graph_id = ?',
      [graphId]
    )
    set({ nodePositions })
  },

  saveNodePosition: async (noteId, x, y) => {
    const graphId = get().activeGraphId
    if (!graphId) return
    await window.api.db.run(
      'INSERT OR REPLACE INTO node_positions (graph_id, note_id, x, y) VALUES (?, ?, ?, ?)',
      [graphId, noteId, x, y]
    )
    set((state) => ({
      nodePositions: [
        ...state.nodePositions.filter((p) => p.note_id !== noteId),
        { graph_id: graphId, note_id: noteId, x, y },
      ],
    }))
  },

  // ── Flashcards ─────────────────────────────────────────────────────────────

  loadFlashcardStates: async () => {
    const flashcardStates = await window.api.db.all<FlashcardState>(
      'SELECT * FROM flashcard_state'
    )
    set({ flashcardStates })
  },

  recordFlashcardResult: async (noteId, correct) => {
    const state = get().flashcardStates.find((s) => s.note_id === noteId)
    if (!state) return

    let { consecutive_correct, interval_stage } = state
    const now = Date.now()

    if (correct) {
      consecutive_correct += 1
      if (consecutive_correct >= 2 && interval_stage < 3) {
        interval_stage = (interval_stage + 1) as IntervalStage
        consecutive_correct = 0
      }
    } else {
      consecutive_correct = 0
      if (interval_stage > 0) interval_stage = (interval_stage - 1) as IntervalStage
    }

    const days = INTERVAL_DAYS[interval_stage as IntervalStage]
    const next_review = days === 0 ? now : daysFromNow(days)

    await window.api.db.run(
      'UPDATE flashcard_state SET next_review = ?, interval_stage = ?, consecutive_correct = ?, last_reviewed = ? WHERE note_id = ?',
      [next_review, interval_stage, consecutive_correct, now, noteId]
    )
    await get().loadFlashcardStates()
  },

  // ── Tags ───────────────────────────────────────────────────────────────────

  getSourceTags: async (sourceId) => {
    const rows = await window.api.db.all<{ tag: string }>(
      'SELECT tag FROM source_tags WHERE source_id = ?',
      [sourceId]
    )
    return rows.map((r) => r.tag)
  },

  getAllTags: async () => {
    const rows = await window.api.db.all<{ tag: string }>(
      'SELECT DISTINCT tag FROM source_tags ORDER BY tag COLLATE NOCASE'
    )
    return rows.map((r) => r.tag)
  },

  addSourceTag: async (sourceId, tag) => {
    await window.api.db.run(
      'INSERT OR IGNORE INTO source_tags (source_id, tag) VALUES (?, ?)',
      [sourceId, tag]
    )
  },

  removeSourceTag: async (sourceId, tag) => {
    await window.api.db.run(
      'DELETE FROM source_tags WHERE source_id = ? AND tag = ?',
      [sourceId, tag]
    )
  },

  // ── Lock-in mode ──────────────────────────────────────────────────────────

  setLockInSetupOpen: (open) => set({ lockInSetupOpen: open }),

  startLockIn: (durationMs) => {
    const { notes, activePage } = get()
    set({
      lockInPhase: 'active',
      lockInSetupOpen: false,
      lockInDurationMs: durationMs,
      lockInStartTime: Date.now(),
      lockInPenaltyMs: 5000,
      lockInPenaltyEndTime: null,
      lockInExitCount: 0,
      lockInStartPage: activePage,
      lockInStartNoteCount: notes.length,
    })
    window.api.window.setFullscreen(true)
    window.api.window.setLockIn(true)
  },

  triggerLockInExit: () => {
    const { lockInPhase, lockInPenaltyMs, lockInExitCount } = get()
    if (lockInPhase !== 'active') return
    set({
      lockInPhase: 'penalty',
      lockInPenaltyEndTime: Date.now() + lockInPenaltyMs,
      lockInExitCount: lockInExitCount + 1,
      lockInPenaltyMs: Math.min(lockInPenaltyMs * 2, 300000),
    })
  },

  penaltyComplete: () => {
    set({ lockInPhase: 'active', lockInPenaltyEndTime: null })
    window.api.window.allowExit()
  },

  completeLockIn: () => {
    set({ lockInPhase: 'complete' })
    window.api.window.setLockIn(false)
  },

  resetLockIn: () => {
    set({
      lockInPhase: 'idle',
      lockInPenaltyEndTime: null,
      lockInExitCount: 0,
      lockInPenaltyMs: 5000,
    })
    window.api.window.setLockIn(false)
    window.api.window.setFullscreen(false)
  },

  // ── Reading goals ──────────────────────────────────────────────────────────

  loadReadingGoal: async (sourceId) => {
    const goal = await window.api.db.get<ReadingGoal>(
      'SELECT * FROM reading_goals WHERE source_id = ?',
      [sourceId]
    )
    set({ readingGoal: goal ?? null })
    if (goal) {
      const deadlines = await window.api.db.all<ChapterDeadline>(
        'SELECT * FROM chapter_deadlines WHERE goal_id = ?',
        [goal.id]
      )
      set({ chapterDeadlines: deadlines })
    } else {
      set({ chapterDeadlines: [] })
    }
  },

  saveReadingGoal: async (sourceId, finishBy, opts = {}) => {
    const existing = await window.api.db.get<{ id: string }>(
      'SELECT id FROM reading_goals WHERE source_id = ?',
      [sourceId]
    )
    const now = Date.now()
    if (existing) {
      await window.api.db.run(
        `UPDATE reading_goals SET finish_by = ?, reminder_frequency = ?, reminder_day = ?,
         reminder_time = ?, estimated_word_count = ?, words_per_page = ?, updated_at = ?
         WHERE id = ?`,
        [
          finishBy,
          opts.reminderFrequency ?? null,
          opts.reminderDay ?? null,
          opts.reminderTime ?? null,
          opts.estimatedWordCount ?? null,
          opts.wordsPerPage ?? null,
          now,
          existing.id,
        ]
      )
    } else {
      const id = uuidv4()
      await window.api.db.run(
        `INSERT INTO reading_goals
         (id, source_id, finish_by, reminder_frequency, reminder_day, reminder_time,
          estimated_word_count, words_per_page, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          sourceId,
          finishBy,
          opts.reminderFrequency ?? null,
          opts.reminderDay ?? null,
          opts.reminderTime ?? null,
          opts.estimatedWordCount ?? null,
          opts.wordsPerPage ?? null,
          now,
          now,
        ]
      )
    }
    await get().loadReadingGoal(sourceId)
  },

  deleteReadingGoal: async (sourceId) => {
    await window.api.db.run('DELETE FROM reading_goals WHERE source_id = ?', [sourceId])
    set({ readingGoal: null, chapterDeadlines: [] })
  },

  loadChapterDeadlines: async (goalId) => {
    const deadlines = await window.api.db.all<ChapterDeadline>(
      'SELECT * FROM chapter_deadlines WHERE goal_id = ?',
      [goalId]
    )
    set({ chapterDeadlines: deadlines })
  },

  saveChapterDeadlines: async (goalId, deadlines) => {
    await window.api.db.run('DELETE FROM chapter_deadlines WHERE goal_id = ?', [goalId])
    for (const d of deadlines) {
      await window.api.db.run(
        'INSERT INTO chapter_deadlines (id, goal_id, outline_item_id, chapter_name, finish_by) VALUES (?, ?, ?, ?, ?)',
        [uuidv4(), goalId, d.outline_item_id ?? null, d.chapter_name, d.finish_by]
      )
    }
    await get().loadChapterDeadlines(goalId)
  },
}))
