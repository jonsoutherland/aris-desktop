export interface KnowledgeSource {
  id: string
  title: string
  type: 'pdf' | 'epub' | 'vocab'
  file_path: string
  created_at: number
  last_opened: number | null
  total_pages: number | null
  current_page: number
  scroll_fraction: number | null
  epub_cfi: string | null
  cover_image: string | null
  author: string | null
  publication_year: number | null
  publisher: string | null
  edition: string | null
  tags?: string[]
}

export interface HighlightType {
  id: string
  name: string
  color: string
  description: string | null
}

export interface HighlightRect {
  x: number
  y: number
  width: number
  height: number
  pageIndex: number
}

export interface Highlight {
  id: string
  source_id: string
  page_number: number
  highlight_type_id: string | null
  selected_text: string
  rects: HighlightRect[]
  cfi: string | null
  created_at: number
  highlight_type?: HighlightType
}

export interface Note {
  id: string
  source_id: string
  highlight_id: string | null
  term: string
  definition: string
  chapter: string | null
  page_number: number | null
  outline_item_id: string | null
  created_at: number
}

export interface OutlineItem {
  id: string
  source_id: string
  parent_id: string | null
  title: string
  page_number: number
  sort_order: number
  depth: number
  origin: 'embedded' | 'toc' | 'heuristic'
}

export interface KnowledgeGraph {
  id: string
  name: string
  created_at: number
}

export interface NoteLink {
  graph_id: string
  from_note_id: string
  to_note_id: string
  relationship: string | null
}

export type IntervalStage = 0 | 1 | 2 | 3

export interface FlashcardState {
  note_id: string
  next_review: number
  interval_stage: IntervalStage
  consecutive_correct: number
  last_reviewed: number | null
}

export interface NodePosition {
  graph_id: string
  note_id: string
  x: number
  y: number
}

export interface ReadingGoal {
  id: string
  source_id: string
  finish_by: number
  reminder_frequency: 'daily' | 'weekly' | null
  reminder_day: number | null
  reminder_time: string | null
  estimated_word_count: number | null
  words_per_page: number | null
  last_reminded_at: number | null
  created_at: number
  updated_at: number
}

export interface ChapterDeadline {
  id: string
  goal_id: string
  outline_item_id: string | null
  chapter_name: string
  finish_by: number
}

export type View = 'library' | 'reader' | 'notes' | 'flashcards' | 'graph' | 'settings' | 'goals' | 'citations' | 'tips'

export interface SelectionState {
  mode: 'term' | 'definition' | null
  term: { text: string; rects: HighlightRect[]; page: number } | null
}
