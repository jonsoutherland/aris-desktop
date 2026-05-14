import { useEffect, useRef, useState, useCallback } from 'react'
import ePub from 'epubjs'
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  NotebookPen, Highlighter, Search, ListTree, X, BookOpen, Trash2,
} from 'lucide-react'
import { useStore } from '../store'
import NotePanel from './NotePanel'
import HighlightPicker from './HighlightPicker'
import DictionaryPopup from './DictionaryPopup'
import { clsx } from 'clsx'
import { v4 as uuidv4 } from 'uuid'
import type { OutlineItem } from '../types'

interface PendingEpubNote {
  term: string
  termCfi: string
  definition: string
  chapterIndex: number
}

function tocToOutlineItems(
  toc: any[],
  sourceId: string,
  book: any,
  parentId: string | null = null,
  depth = 0,
  counter = { n: 0 },
): OutlineItem[] {
  const result: OutlineItem[] = []
  for (const item of toc) {
    const href = item.href?.split('#')[0] ?? ''
    const spineItem = book.spine.get(href)
    const id = item.id ? String(item.id) : uuidv4()
    result.push({
      id,
      source_id: sourceId,
      parent_id: parentId,
      title: (item.label ?? item.title ?? 'Untitled').trim(),
      page_number: (spineItem?.index ?? 0) + 1,
      sort_order: counter.n++,
      depth,
      origin: 'toc',
    })
    if (item.subitems?.length) {
      result.push(...tocToOutlineItems(item.subitems, sourceId, book, id, depth + 1, counter))
    }
  }
  return result
}

function findWordRangeInDoc(caretRange: Range, doc: Document): Range | null {
  const node = caretRange.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent ?? ''
  let start = caretRange.startOffset
  let end = start
  while (start > 0 && !/[\s ]/.test(text[start - 1])) start--
  while (end < text.length && !/[\s ]/.test(text[end])) end++
  if (start >= end) return null
  const r = doc.createRange()
  r.setStart(node, start)
  r.setEnd(node, end)
  return r
}

export default function EpubReader() {
  const {
    activeSourceId, sources, highlights, highlightTypes, activeHighlightTypeId,
    activePage, setActivePage,
    addHighlight, deleteHighlight, addNote, deleteNote,
    loadHighlights, loadNotes, notes, saveEpubPosition,
    outline, loadOutline, saveOutline,
  } = useStore()

  const source = sources.find((s) => s.id === activeSourceId)

  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<any>(null)
  const renditionRef = useRef<any>(null)
  // Direct reference to the current chapter's view — used to call view.highlight/unhighlight
  // instead of rendition.annotations.*, which has an inject hook that causes duplicate marks.
  const currentViewRef = useRef<any>(null)

  const highlightsRef = useRef(highlights)
  useEffect(() => { highlightsRef.current = highlights }, [highlights])

  const appliedCfisRef = useRef<Set<string>>(new Set())
  const currentChapterRef = useRef(0)
  const relocatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [fontSize, setFontSize] = useState(100)
  const fontSizeRef = useRef(100)
  useEffect(() => { fontSizeRef.current = fontSize }, [fontSize])
  const [totalChapters, setTotalChapters] = useState(0)
  const totalChaptersRef = useRef(0)
  useEffect(() => { totalChaptersRef.current = totalChapters }, [totalChapters])

  // Note-taking state — mirrors PDF Reader exactly
  const [notePhase, setNotePhase] = useState<null | 'waitingDefinition'>(null)
  const [pendingTerm, setPendingTerm] = useState<{ text: string; cfi: string } | null>(null)
  const [pendingNote, setPendingNote] = useState<PendingEpubNote | null>(null)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [fromHighlight, setFromHighlight] = useState<{ id: string; text: string; chapterIndex: number } | null>(null)

  const [dblClickMenu, setDblClickMenu] = useState<{
    word: string; cfi: string; anchorX: number; anchorTop: number; anchorBottom: number
  } | null>(null)
  const [dictEntry, setDictEntry] = useState<{
    word: string; anchorX: number; anchorTop: number; anchorBottom: number
  } | null>(null)
  const [highlightMenu, setHighlightMenu] = useState<{
    id: string; cfi: string; text: string; anchorX: number; anchorTop: number
  } | null>(null)

  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const [showOutlineSidebar, setShowOutlineSidebar] = useState(false)
  const [showNotesSidebar, setShowNotesSidebar] = useState(false)
  const [notesSidebarQuery, setNotesSidebarQuery] = useState('')

  type UndoAction =
    | { type: 'highlight'; id: string }
    | { type: 'note'; noteId: string; highlightId: string }
  const undoStack = useRef<UndoAction[]>([])

  // Refs for values used inside stable callbacks / event handlers
  const isDblClickRef = useRef(false)
  const dblClickPosRef = useRef<{ x: number; y: number } | null>(null)
  // tracks last mousedown pos inside the iframe — used for annotation menu positioning
  // because marks-pane clones events via Object.assign which loses non-own props (clientX/Y → 0)
  const lastMouseDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // true while the left mouse button is held inside the iframe — used to defer highlights
  // until mouseup so the mark doesn't appear while the user is still dragging
  const isMouseDownRef = useRef(false)
  // epubjs debounces selectionchange by 250ms, so `selected` can fire before mouseup when
  // dragging slowly across paragraphs. save it here; mouseup will process it.
  const pendingSelectionRef = useRef<{ text: string; cfi: string; wasDblClick: boolean } | null>(null)
  const notePhaseRef = useRef<null | 'waitingDefinition'>(null)
  const pendingTermRef = useRef<{ text: string; cfi: string } | null>(null)

  useEffect(() => { notePhaseRef.current = notePhase }, [notePhase])
  useEffect(() => { pendingTermRef.current = pendingTerm }, [pendingTerm])

  const wordHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wordHoverWordRef = useRef<string | null>(null)
  const hoverKeyRef = useRef(0)
  const dblClickMenuOpenRef = useRef(false)
  useEffect(() => { dblClickMenuOpenRef.current = !!dblClickMenu }, [dblClickMenu])

  const [hoverUnderline, setHoverUnderline] = useState<{ left: number; top: number; width: number; key: number } | null>(null)

  const clearWordHoverTimer = useCallback(() => {
    if (wordHoverTimerRef.current) {
      clearTimeout(wordHoverTimerRef.current)
      wordHoverTimerRef.current = null
    }
    wordHoverWordRef.current = null
    setHoverUnderline(null)
  }, [])

  const handleUndoRef = useRef<() => void>(() => {})
  handleUndoRef.current = () => {
    const action = undoStack.current.pop()
    if (!action) return
    if (action.type === 'highlight') {
      const hl = highlightsRef.current.find((h) => h.id === action.id)
      if (hl?.cfi) {
        purgeViewCfi(currentViewRef.current, hl.cfi)
        // Do NOT remove from appliedCfisRef here. If the 80ms rendered-timeout fires
        // before deleteHighlight updates the store, applyHighlightsForChapter would see
        // the stale highlights, miss the CFI in applied, and re-add the mark (ghost).
        // The cleanup loop handles removal from applied once the store is updated.
      }
      deleteHighlight(action.id)
    } else {
      const hl = highlightsRef.current.find((h) => h.id === action.highlightId)
      if (hl?.cfi) {
        purgeViewCfi(currentViewRef.current, hl.cfi)
      }
      deleteNote(action.noteId)
      deleteHighlight(action.highlightId)
    }
  }

  // Ref-based annotation click handler so it always sees fresh state/closures.
  // Uses lastMouseDownPosRef for position because marks-pane clones events with Object.assign,
  // which doesn't copy inherited accessor props (clientX/Y), leaving them as 0.
  const handleAnnotationClickRef = useRef<(hlId: string, e: any) => void>(() => {})
  handleAnnotationClickRef.current = (hlId: string, _e: any) => {
    const hl = highlightsRef.current.find((h) => h.id === hlId)
    if (!hl) return
    const pos = lastMouseDownPosRef.current
    const iframeEl = viewerRef.current?.querySelector('iframe')
    const iframeRect = iframeEl?.getBoundingClientRect()
    const anchorX = iframeRect ? iframeRect.left + pos.x : pos.x
    const anchorTop = iframeRect ? iframeRect.top + pos.y : pos.y
    setHighlightMenu({ id: hlId, cfi: hl.cfi ?? '', text: hl.selected_text, anchorX, anchorTop })
  }

  // Processes a finalised selection — called from `selected` when mouseup already happened,
  // or from the mouseup handler when the 250ms debounce fired early (before mouseup).
  const handleSelectionRef = useRef<(text: string, cfi: string, wasDblClick: boolean) => void>(() => {})
  handleSelectionRef.current = (text: string, cfi: string, wasDblClick: boolean) => {
    if (!text) return
    if (notePhaseRef.current === 'waitingDefinition') {
      const term = pendingTermRef.current
      if (term) {
        setPendingNote({
          term: term.text, termCfi: term.cfi, definition: text,
          chapterIndex: currentChapterRef.current,
        })
        setNotePhase(null)
        setPendingTerm(null)
        setShowNotePanel(true)
      }
      return
    }
    if (wasDblClick) {
      const pos = dblClickPosRef.current
      dblClickPosRef.current = null
      const iframeEl = viewerRef.current?.querySelector('iframe')
      const iframeRect = iframeEl?.getBoundingClientRect()
      const anchorX = (pos && iframeRect) ? iframeRect.left + pos.x : window.innerWidth / 2
      const anchorTop = (pos && iframeRect) ? iframeRect.top + pos.y - 10 : window.innerHeight / 2
      setDblClickMenu({ word: text, cfi, anchorX, anchorTop, anchorBottom: anchorTop + 30 })
    } else {
      autoHighlightRef.current(text, cfi, currentChapterRef.current)
    }
  }

  // Ref-based auto-highlight so the selected callback always sees latest highlight type.
  // Uses view.highlight() directly (not rendition.annotations) to avoid epubjs's inject hook
  // re-adding the same mark on every rendered event, which caused double-opacity + zombie rects.
  const autoHighlightRef = useRef<(text: string, cfi: string, chapterIndex: number) => void>(async () => {})
  autoHighlightRef.current = async (text: string, cfi: string, chapterIndex: number) => {
    if (!activeSourceId) return
    const color = highlightTypes.find((t) => t.id === activeHighlightTypeId)?.color ?? '#2978a0'
    const hl = await addHighlight(activeSourceId, chapterIndex, text, [], activeHighlightTypeId ?? undefined, cfi)
    undoStack.current.push({ type: 'highlight', id: hl.id })
    try {
      purgeViewCfi(currentViewRef.current, cfi)
      currentViewRef.current?.highlight(
        cfi, {},
        (e: any) => handleAnnotationClickRef.current(hl.id, e),
        'aris-highlight',
        { fill: color, 'fill-opacity': '0.45' },
      )
      appliedCfisRef.current.add(cfi)
    } catch {}
    // Clear iframe selection so the browser's native selection highlight doesn't linger
    try {
      const iframeWin = viewerRef.current?.querySelector('iframe')?.contentWindow
      iframeWin?.getSelection()?.removeAllRanges()
    } catch {}
  }

  const cancelNote = () => {
    setNotePhase(null)
    setPendingTerm(null)
  }

  // Escape cancels note phase
  useEffect(() => {
    if (!notePhase) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelNote() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notePhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close dblClickMenu on outside click or Escape (both outer doc and inside iframe)
  useEffect(() => {
    if (!dblClickMenu) return
    const onOuterMouse = (e: MouseEvent) => {
      const el = document.getElementById('epub-dbl-click-menu')
      if (el && !el.contains(e.target as Node)) setDblClickMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDblClickMenu(null) }
    const closeFromIframe = () => setDblClickMenu(null)
    document.addEventListener('mousedown', onOuterMouse)
    document.addEventListener('keydown', onKey)
    const iframeWin = viewerRef.current?.querySelector('iframe')?.contentWindow
    if (iframeWin) {
      iframeWin.addEventListener('mousedown', closeFromIframe)
      iframeWin.addEventListener('keydown', onKey as EventListener)
    }
    return () => {
      document.removeEventListener('mousedown', onOuterMouse)
      document.removeEventListener('keydown', onKey)
      try {
        if (iframeWin) {
          iframeWin.removeEventListener('mousedown', closeFromIframe)
          iframeWin.removeEventListener('keydown', onKey as EventListener)
        }
      } catch {}
    }
  }, [dblClickMenu])

  // Close highlightMenu on outside click (both outer doc and inside iframe)
  useEffect(() => {
    if (!highlightMenu) return
    const onOuterMouse = (e: MouseEvent) => {
      const el = document.getElementById('epub-hl-ctx-menu')
      if (el && !el.contains(e.target as Node)) setHighlightMenu(null)
    }
    const closeFromIframe = () => setHighlightMenu(null)
    document.addEventListener('mousedown', onOuterMouse)
    const iframeWin = viewerRef.current?.querySelector('iframe')?.contentWindow
    if (iframeWin) iframeWin.addEventListener('mousedown', closeFromIframe)
    return () => {
      document.removeEventListener('mousedown', onOuterMouse)
      try { if (iframeWin) iframeWin.removeEventListener('mousedown', closeFromIframe) } catch {}
    }
  }, [highlightMenu])

  // ── Highlight sync ─────────────────────────────────────────────────────────

  // Remove ALL pane marks for a CFI, including zombies left behind when view.highlight()
  // is called twice for the same CFI. view.unhighlight() only removes the tracked mark
  // (the last one added) — this purge iterates pane.marks directly to catch orphans.
  const purgeViewCfi = useCallback((view: any, cfi: string) => {
    if (!view) return
    try {
      const marks: any[] = view.pane?.marks ? [...view.pane.marks] : []
      marks.forEach((m) => {
        if (m.data?.epubcfi === cfi) {
          try { view.pane.removeMark(m) } catch {}
        }
      })
      if (view.highlights?.[cfi]) delete view.highlights[cfi]
    } catch {}
  }, [])

  const applyHighlightsForChapter = useCallback((chapterIndex: number) => {
    const view = currentViewRef.current
    if (!view) return

    const applied = appliedCfisRef.current
    const chapterHls = highlightsRef.current.filter(
      (h) => h.page_number === chapterIndex && h.cfi,
    )
    const activeCfis = new Set(chapterHls.map((h) => h.cfi!))

    for (const cfi of [...applied]) {
      if (!activeCfis.has(cfi)) {
        purgeViewCfi(view, cfi)
        applied.delete(cfi)
      }
    }

    for (const hl of chapterHls) {
      if (applied.has(hl.cfi!)) continue
      const color = hl.highlight_type?.color ?? '#2978a0'
      try {
        purgeViewCfi(view, hl.cfi!)  // clear any zombie before adding
        view.highlight(
          hl.cfi!, {},
          (e: any) => handleAnnotationClickRef.current(hl.id, e),
          'aris-highlight',
          { fill: color, 'fill-opacity': '0.45' },
        )
        applied.add(hl.cfi!)
      } catch {}
    }
  }, [purgeViewCfi])

  useEffect(() => {
    applyHighlightsForChapter(currentChapterRef.current)
  }, [highlights, applyHighlightsForChapter])

  // ── Book loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!source || source.type !== 'epub' || !viewerRef.current) return

    loadHighlights(source.id)
    loadNotes(source.id)
    loadOutline(source.id)

    appliedCfisRef.current = new Set()

    const book = ePub(`file://${source.file_path}`)
    bookRef.current = book

    const rendition = book.renderTo(viewerRef.current, {
      width: '100%',
      height: '100%',
      flow: 'scrolled-doc',
      spread: 'none',
    })
    renditionRef.current = rendition

    rendition.themes.register('aris', {
      body: {
        background: '#181d27 !important',
        color: '#e3d0d8 !important',
        'font-family': "'Poppins', Georgia, serif !important",
        'line-height': '1.8 !important',
        padding: '24px 48px !important',
        'max-width': '700px !important',
        margin: '0 auto !important',
      },
      'h1, h2, h3, h4, h5, h6': { color: '#e3d0d8 !important' },
      'p, li, td, th, span, div': { color: '#e3d0d8 !important' },
      a: { color: '#2978a0 !important' },
      img: { 'max-width': '100% !important' },
    })
    rendition.themes.select('aris')

    book.ready.then(async () => {
      const spineLen = book.spine.items.length
      setTotalChapters(spineLen)

      await window.api.db.run(
        'UPDATE knowledge_sources SET total_pages = ? WHERE id = ?',
        [spineLen, source.id],
      )

      const nav = book.navigation
      if (nav?.toc?.length > 0) {
        const existing = await window.api.db.all<{ c: number }>(
          'SELECT COUNT(*) as c FROM source_outline_items WHERE source_id = ?',
          [source.id],
        )
        if ((existing[0]?.c ?? 0) === 0) {
          const items = tocToOutlineItems(nav.toc, source.id, book)
          if (items.length > 0) await saveOutline(source.id, items)
        }
      }

      const startIdx = Math.max(0, Math.min(spineLen - 1, (source.current_page ?? 1) - 1))
      currentChapterRef.current = startIdx
      setActivePage(startIdx + 1)
      if (source.epub_cfi) {
        rendition.display(source.epub_cfi)
      } else {
        const startItem = book.spine.get(startIdx)
        rendition.display(startItem?.href ?? undefined)
      }
    })

    rendition.on('rendered', (section: any, view: any) => {
      const idx: number = section.index
      // Only clear applied-CFI tracking when the view object itself changes (chapter nav,
      // view recreation). Re-renders of the same view (theme apply, font resize, etc.)
      // must NOT clear it — that would cause applyHighlightsForChapter to re-add every
      // mark to the same view, creating duplicate SVG rects that appear brighter and
      // leave a ghost after deletion.
      const viewChanged = view !== currentViewRef.current
      currentChapterRef.current = idx
      currentViewRef.current = view
      setActivePage(idx + 1)
      if (viewChanged) {
        appliedCfisRef.current = new Set()
      }
      setTimeout(() => {
        applyFontSize(fontSizeRef.current)
        applyHighlightsForChapter(idx)
      }, 80)

      const iframeWin: Window | undefined = view?.window
      if (iframeWin) {
        // Detect double-click by mousedown timing (dblclick fires after `selected`, so
        // checking isDblClickRef in `selected` would always see false if using dblclick event).
        // Also tracks position for annotation click menus (marks-pane clones events via
        // Object.assign which drops inherited MouseEvent props like clientX/Y → 0).
        let lastMouseDownTime = 0
        iframeWin.addEventListener('mousedown', (e: MouseEvent) => {
          const now = Date.now()
          lastMouseDownPosRef.current = { x: e.clientX, y: e.clientY }
          isMouseDownRef.current = true
          if (now - lastMouseDownTime < 300) {
            isDblClickRef.current = true
            dblClickPosRef.current = { x: e.clientX, y: e.clientY }
          } else {
            isDblClickRef.current = false
          }
          lastMouseDownTime = now
        })

        iframeWin.addEventListener('mouseup', () => {
          isMouseDownRef.current = false
          // If the 250ms debounce fired before mouseup, process the saved selection now
          const pending = pendingSelectionRef.current
          if (pending) {
            pendingSelectionRef.current = null
            isDblClickRef.current = false
            handleSelectionRef.current(pending.text, pending.cfi, pending.wasDblClick)
          }
        })

        iframeWin.addEventListener('wheel', (e: WheelEvent) => {
          if (!e.ctrlKey) return
          e.preventDefault()
          setFontSize((prev) => Math.max(70, Math.min(160, prev + (e.deltaY < 0 ? 10 : -10))))
        }, { passive: false })

        iframeWin.addEventListener('keydown', (e: KeyboardEvent) => {
          const active = (iframeWin as any).document?.activeElement
          if (
            active instanceof (iframeWin as any).HTMLInputElement ||
            active instanceof (iframeWin as any).HTMLTextAreaElement ||
            (active as HTMLElement)?.isContentEditable
          ) return
          if (e.ctrlKey && e.key === 'z') {
            e.preventDefault()
            handleUndoRef.current()
            return
          }
          handleKeyNav(e as unknown as KeyboardEvent)
        })

        iframeWin.addEventListener('mousemove', (e: MouseEvent) => {
          if (notePhaseRef.current !== null || dblClickMenuOpenRef.current) return
          const iframeEl = iframeWin.frameElement as HTMLElement | null
          const iframeRect = iframeEl?.getBoundingClientRect()
          if (!iframeRect) return
          const iframeDoc = (iframeWin as any).document as Document
          const caret = iframeDoc.caretRangeFromPoint?.(e.clientX, e.clientY)
          if (!caret) { clearWordHoverTimer(); return }
          const wordRange = findWordRangeInDoc(caret, iframeDoc)
          if (!wordRange) { clearWordHoverTimer(); return }
          const word = wordRange.toString().replace(/[^a-zA-Z''-]/g, '')
          if (!word) { clearWordHoverTimer(); return }
          const rect = wordRange.getBoundingClientRect()
          const anchorX = (rect.left + rect.right) / 2 + iframeRect.left
          const anchorTop = rect.top + iframeRect.top
          const anchorBottom = rect.bottom + iframeRect.top
          if (e.ctrlKey) {
            clearWordHoverTimer()
            wordHoverWordRef.current = word
            setDictEntry({ word, anchorX, anchorTop, anchorBottom })
            return
          }
          if (wordHoverWordRef.current === word) return
          clearWordHoverTimer()
          wordHoverWordRef.current = word
          hoverKeyRef.current += 1
          setHoverUnderline({ left: rect.left + iframeRect.left, top: rect.bottom + iframeRect.top + 1, width: rect.width, key: hoverKeyRef.current })
          wordHoverTimerRef.current = setTimeout(() => {
            setHoverUnderline(null)
            setDictEntry({ word, anchorX, anchorTop, anchorBottom })
            wordHoverTimerRef.current = null
          }, 3000)
        })

        iframeWin.addEventListener('mouseleave', () => clearWordHoverTimer())
      }
    })

    rendition.on('relocated', (location: any) => {
      const cfi = location?.start?.cfi
      const idx: number = location?.start?.index ?? currentChapterRef.current
      if (!cfi) return
      currentChapterRef.current = idx
      setActivePage(idx + 1)
      if (relocatedTimerRef.current) clearTimeout(relocatedTimerRef.current)
      relocatedTimerRef.current = setTimeout(() => {
        saveEpubPosition(source.id, idx + 1, cfi)
        relocatedTimerRef.current = null
      }, 400)
    })

    // Selected fires on every selectionchange (debounced 250ms by epubjs). For quick drags
    // mouseup has already fired so isMouseDownRef is false and we process immediately.
    // For slow/multi-paragraph drags the debounce can fire before mouseup — save as pending
    // and process in the mouseup handler above so we never lose the selection.
    rendition.on('selected', (cfi: string, contents: any) => {
      const text = contents.window.getSelection()?.toString().trim() ?? ''
      const wasDblClick = isDblClickRef.current

      if (isMouseDownRef.current) {
        // Debounce fired before mouseup — defer to mouseup handler
        if (text) pendingSelectionRef.current = { text, cfi, wasDblClick }
        return
      }

      isDblClickRef.current = false
      pendingSelectionRef.current = null
      handleSelectionRef.current(text, cfi, wasDblClick)
    })

    return () => {
      if (relocatedTimerRef.current) clearTimeout(relocatedTimerRef.current)
      try { rendition.destroy() } catch {}
      try { book.destroy() } catch {}
      bookRef.current = null
      renditionRef.current = null
      currentViewRef.current = null
      appliedCfisRef.current = new Set()
      pendingSelectionRef.current = null
      isMouseDownRef.current = false
      setTotalChapters(0)
      cancelNote()
      setDblClickMenu(null)
      setHighlightMenu(null)
      setDictEntry(null)
    }
  }, [source?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Font size ──────────────────────────────────────────────────────────────

  const applyFontSize = useCallback((size: number) => {
    try {
      const contents: any[] = renditionRef.current?.getContents?.() ?? []
      contents.forEach((c: any) => {
        const html = c?.document?.documentElement as HTMLElement | undefined
        if (html) html.style.setProperty('font-size', `${size}%`, 'important')
      })
    } catch {}
  }, [])

  useEffect(() => { applyFontSize(fontSize) }, [fontSize, applyFontSize])

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setFontSize((prev) => Math.max(70, Math.min(160, prev + (e.deltaY < 0 ? 10 : -10))))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  // ── Ctrl+Z undo ────────────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'z') return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      e.preventDefault()
      handleUndoRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goToChapter = useCallback((index: number) => {
    const book = bookRef.current
    if (!book || !renditionRef.current) return
    const clamped = Math.max(0, Math.min(book.spine.items.length - 1, index))
    const item = book.spine.get(clamped)
    if (item?.href) renditionRef.current.display(item.href)
  }, [])

  const handleKeyNav = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        if (e.ctrlKey || e.altKey || e.metaKey) return
        e.preventDefault()
        goToChapter(currentChapterRef.current + 1)
        break
      case 'ArrowLeft':
        if (e.ctrlKey || e.altKey || e.metaKey) return
        e.preventDefault()
        goToChapter(currentChapterRef.current - 1)
        break
      case ' ':
        e.preventDefault()
        goToChapter(currentChapterRef.current + (e.shiftKey ? -1 : 1))
        break
      case 'Home':
        if (e.ctrlKey || e.altKey) return
        e.preventDefault()
        goToChapter(0)
        break
      case 'End':
        if (e.ctrlKey || e.altKey) return
        e.preventDefault()
        goToChapter(totalChaptersRef.current - 1)
        break
      case '=':
      case '+':
        if (!e.ctrlKey) return
        e.preventDefault()
        setFontSize((prev) => Math.min(160, prev + 10))
        break
      case '-':
        if (!e.ctrlKey) return
        e.preventDefault()
        setFontSize((prev) => Math.max(70, prev - 10))
        break
      case '0':
        if (!e.ctrlKey) return
        e.preventDefault()
        setFontSize(100)
        break
    }
  }, [goToChapter])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement)?.isContentEditable
      ) return
      handleKeyNav(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleKeyNav])

  // ── Actions ────────────────────────────────────────────────────────────────

  // Called from the double-click menu "Create note" button
  const handleStartNote = () => {
    if (!dblClickMenu) return
    setPendingTerm({ text: dblClickMenu.word, cfi: dblClickMenu.cfi })
    setNotePhase('waitingDefinition')
    setDblClickMenu(null)
  }

  // Save a term+definition note after the two-step selection flow
  const handleSaveNote = async (term: string, definition: string) => {
    if (!activeSourceId || !pendingNote) return
    const color = highlightTypes.find((t) => t.id === activeHighlightTypeId)?.color ?? '#2978a0'
    const hl = await addHighlight(
      activeSourceId, pendingNote.chapterIndex, pendingNote.term, [],
      activeHighlightTypeId ?? undefined, pendingNote.termCfi,
    )
    const note = await addNote(activeSourceId, term, definition, {
      highlightId: hl.id,
      page: pendingNote.chapterIndex + 1,
    })
    undoStack.current.push({ type: 'note', noteId: note.id, highlightId: hl.id })
    try {
      purgeViewCfi(currentViewRef.current, pendingNote.termCfi)
      currentViewRef.current?.highlight(
        pendingNote.termCfi, {},
        (e: any) => handleAnnotationClickRef.current(hl.id, e),
        'aris-highlight',
        { fill: color, 'fill-opacity': '0.45' },
      )
      appliedCfisRef.current.add(pendingNote.termCfi)
    } catch {}
    setPendingNote(null)
    setShowNotePanel(false)
  }

  // Save a note created from a highlight context menu
  const handleSaveNoteFromHighlight = async (term: string, definition: string) => {
    if (!activeSourceId || !fromHighlight) return
    await addNote(activeSourceId, term, definition, {
      highlightId: fromHighlight.id,
      page: fromHighlight.chapterIndex + 1,
    })
    setFromHighlight(null)
    setShowNotePanel(false)
  }

  const handleDeleteHighlightFromMenu = () => {
    if (!highlightMenu) return
    purgeViewCfi(currentViewRef.current, highlightMenu.cfi)
    // Do NOT remove from appliedCfisRef here — see comment in undo handler below.
    deleteHighlight(highlightMenu.id)
    setHighlightMenu(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeType = highlightTypes.find((t) => t.id === activeHighlightTypeId)
  const chapterNum = activePage
  const currentOutlineItem = outline.find((o) => o.page_number === chapterNum)

  return (
    <div className="flex h-full overflow-hidden">

      {/* Outline sidebar */}
      {showOutlineSidebar && (
        <aside className="w-72 shrink-0 border-r border-white/5 bg-ink flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <h2 className="text-sm font-medium text-blush flex items-center gap-2">
              <ListTree size={14} className="text-ocean" />
              Contents
              <span className="text-lavender/40 text-xs">({outline.length})</span>
            </h2>
            <button
              onClick={() => setShowOutlineSidebar(false)}
              className="p-1 text-lavender/40 hover:text-blush transition-colors rounded"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {outline.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-lavender/40">
                No table of contents found.
              </div>
            ) : (
              <ul>
                {outline.map((it) => {
                  const active = it.page_number === chapterNum
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => goToChapter(it.page_number - 1)}
                        className={clsx(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-baseline gap-2',
                          active ? 'bg-ocean/15 text-blush' : 'text-lavender/70 hover:bg-white/5',
                        )}
                        style={{ paddingLeft: `${12 + it.depth * 14}px` }}
                      >
                        <span className="flex-1 truncate">{it.title}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-ink border-b border-white/5 shrink-0">
          <button
            onClick={() => setShowOutlineSidebar((v) => !v)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              showOutlineSidebar
                ? 'bg-ocean/20 text-ocean'
                : 'text-lavender/50 hover:text-blush hover:bg-white/5',
            )}
            title="Toggle table of contents"
          >
            <ListTree size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          <button
            onClick={() => goToChapter(currentChapterRef.current - 1)}
            disabled={chapterNum <= 1}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <div className="flex items-center gap-1.5 text-xs text-lavender/60 min-w-0">
            <span className="truncate max-w-48 text-blush/70">
              {currentOutlineItem?.title ?? `Chapter ${chapterNum}`}
            </span>
            {totalChapters > 0 && (
              <span className="text-lavender/30 shrink-0">/ {totalChapters}</span>
            )}
          </div>

          <button
            onClick={() => goToChapter(currentChapterRef.current + 1)}
            disabled={chapterNum >= totalChapters}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          <button
            onClick={() => setFontSize((s) => Math.max(70, s - 10))}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 transition-colors"
            title="Decrease font size"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-lavender/50 w-10 text-center">{fontSize}%</span>
          <button
            onClick={() => setFontSize((s) => Math.min(160, s + 10))}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 transition-colors"
            title="Increase font size"
          >
            <ZoomIn size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Waiting-for-definition status — mirrors PDF toolbar indicator */}
          {notePhase === 'waitingDefinition' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-blush/80 font-medium">Drag to select definition</span>
              <button
                onClick={cancelNote}
                className="text-xs text-lavender/40 hover:text-lavender transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Highlight type picker */}
          <div className="relative">
            <button
              onClick={() => setShowHighlightPicker((v) => !v)}
              className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: activeType?.color ?? '#aea3b0' }}
              />
              <Highlighter size={13} className="text-lavender/50" />
              <span className="text-lavender/70">{activeType?.name ?? 'No highlight'}</span>
            </button>
            {showHighlightPicker && (
              <HighlightPicker onClose={() => setShowHighlightPicker(false)} />
            )}
          </div>

          <button
            onClick={() => setShowNotesSidebar((v) => !v)}
            className={clsx(
              'flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors',
              showNotesSidebar
                ? 'bg-ocean/20 text-ocean'
                : 'bg-white/5 text-lavender/70 hover:bg-white/10',
            )}
            title="Show notes"
          >
            <NotebookPen size={13} />
            <span>Notes</span>
          </button>
        </div>

        {/* EPUB viewer */}
        <div ref={viewerRef} className="flex-1 overflow-hidden bg-ink" />
      </div>

      {/* Notes sidebar */}
      {showNotesSidebar && (
        <aside className="w-80 shrink-0 border-l border-white/5 bg-ink flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <h2 className="text-sm font-medium text-blush flex items-center gap-2">
              <NotebookPen size={14} className="text-ocean" />
              Notes
              <span className="text-lavender/40 text-xs">({notes.length})</span>
            </h2>
            <button
              onClick={() => setShowNotesSidebar(false)}
              className="p-1 text-lavender/40 hover:text-blush transition-colors rounded"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-3 py-2 border-b border-white/5">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lavender/30" />
              <input
                type="text"
                value={notesSidebarQuery}
                onChange={(e) => setNotesSidebarQuery(e.target.value)}
                placeholder="Search notes…"
                className="w-full bg-white/5 border border-white/10 rounded pl-7 pr-2 py-1.5 text-xs text-blush outline-none focus:border-ocean/50"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(() => {
              const q = notesSidebarQuery.trim().toLowerCase()
              const filtered = q
                ? notes.filter(
                    (n) =>
                      n.term.toLowerCase().includes(q) ||
                      n.definition.toLowerCase().includes(q),
                  )
                : notes
              if (filtered.length === 0) {
                return (
                  <div className="px-4 py-8 text-center text-xs text-lavender/40">
                    {notes.length === 0 ? 'No notes yet.' : 'No matches.'}
                  </div>
                )
              }
              return (
                <ul className="divide-y divide-white/5">
                  {filtered.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => n.page_number && goToChapter(n.page_number - 1)}
                        className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors group"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="font-medium text-sage text-sm truncate">{n.term}</span>
                          {n.chapter && (
                            <span className="text-[10px] text-lavender/40 shrink-0 group-hover:text-ocean transition-colors truncate max-w-24">
                              {n.chapter}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-lavender/70 line-clamp-3 leading-relaxed">
                          {n.definition}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </div>
        </aside>
      )}

      {/* Double-click floating menu — identical structure to PDF's dblClickMenu */}
      {dblClickMenu && (() => {
        const MENU_W = 232
        const MENU_H = 100
        const MARGIN = 8
        const showAbove = dblClickMenu.anchorTop - MENU_H - MARGIN > 0
        const top = showAbove
          ? dblClickMenu.anchorTop - MENU_H - MARGIN
          : dblClickMenu.anchorBottom + MARGIN
        const left = Math.max(MARGIN, Math.min(
          dblClickMenu.anchorX - MENU_W / 2,
          window.innerWidth - MENU_W - MARGIN,
        ))
        return (
          <div
            id="epub-dbl-click-menu"
            className="fixed z-[500] bg-[#1e2535] border border-white/10 rounded-xl shadow-2xl px-2 py-2 flex flex-col gap-1"
            style={{ width: MENU_W, top, left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="px-2 pb-1 text-[10px] text-lavender/40 truncate border-b border-white/5 mb-0.5">
              &ldquo;{dblClickMenu.word.length > 32 ? dblClickMenu.word.slice(0, 32) + '…' : dblClickMenu.word}&rdquo;
            </p>
            <button
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-blush hover:bg-white/8 transition-colors text-left"
              onClick={() => {
                autoHighlightRef.current(dblClickMenu.word, dblClickMenu.cfi, currentChapterRef.current)
                setDblClickMenu(null)
              }}
            >
              <Highlighter size={13} className="text-amber-400 shrink-0" />
              Highlight
            </button>
            <button
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-blush hover:bg-white/8 transition-colors text-left"
              onClick={handleStartNote}
            >
              <NotebookPen size={13} className="text-ocean shrink-0" />
              Create note
            </button>
            <button
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-blush hover:bg-white/8 transition-colors text-left"
              onClick={() => {
                const firstWord = dblClickMenu.word.split(/\s+/)[0].replace(/[^a-zA-Z''-]/g, '')
                if (firstWord) {
                  setDictEntry({
                    word: firstWord,
                    anchorX: dblClickMenu.anchorX,
                    anchorTop: dblClickMenu.anchorTop,
                    anchorBottom: dblClickMenu.anchorBottom,
                  })
                }
                setDblClickMenu(null)
              }}
            >
              <BookOpen size={13} className="text-sage shrink-0" />
              Look up definition
            </button>
          </div>
        )
      })()}

      {/* Highlight context menu — appears when clicking an annotation */}
      {highlightMenu && (() => {
        const MENU_W = 190
        const MARGIN = 8
        const top = highlightMenu.anchorTop - 8
        const left = Math.max(MARGIN, Math.min(
          highlightMenu.anchorX - MENU_W / 2,
          window.innerWidth - MENU_W - MARGIN,
        ))
        return (
          <div
            id="epub-hl-ctx-menu"
            className="fixed z-[500] bg-ink border border-white/15 rounded-lg shadow-xl overflow-hidden"
            style={{ top, left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs text-blush hover:bg-white/8 w-full text-left whitespace-nowrap transition-colors"
              onClick={() => {
                setFromHighlight({
                  id: highlightMenu.id,
                  text: highlightMenu.text,
                  chapterIndex: currentChapterRef.current,
                })
                setPendingNote(null)
                setShowNotePanel(true)
                setHighlightMenu(null)
              }}
            >
              <NotebookPen size={12} className="text-ocean" />
              Create note
            </button>
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs text-blush hover:bg-white/8 w-full text-left whitespace-nowrap transition-colors"
              onClick={() => {
                const firstWord = highlightMenu.text.trim().split(/\s+/)[0].replace(/[^a-zA-Z''-]/g, '')
                if (firstWord) {
                  setDictEntry({
                    word: firstWord,
                    anchorX: highlightMenu.anchorX,
                    anchorTop: highlightMenu.anchorTop - 20,
                    anchorBottom: highlightMenu.anchorTop + 20,
                  })
                }
                setHighlightMenu(null)
              }}
            >
              <BookOpen size={12} className="text-sage" />
              Look up definition
            </button>
            <div className="border-t border-white/5" />
            <button
              className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-white/8 w-full text-left whitespace-nowrap transition-colors"
              onClick={handleDeleteHighlightFromMenu}
            >
              <Trash2 size={12} />
              Delete highlight
            </button>
          </div>
        )
      })()}

      {hoverUnderline && (
        <div
          key={hoverUnderline.key}
          className="word-hover-underline"
          style={{ left: hoverUnderline.left, top: hoverUnderline.top, width: hoverUnderline.width }}
        />
      )}

      {/* Dictionary popup */}
      {dictEntry && (
        <DictionaryPopup
          word={dictEntry.word}
          anchorX={dictEntry.anchorX}
          anchorTop={dictEntry.anchorTop}
          anchorBottom={dictEntry.anchorBottom}
          onClose={() => setDictEntry(null)}
        />
      )}

      {/* Note panel — handles both new-note and from-highlight flows */}
      {showNotePanel && (pendingNote || fromHighlight) && (
        <NotePanel
          initialTerm={fromHighlight ? fromHighlight.text : pendingNote!.term}
          initialDefinition={fromHighlight ? '' : pendingNote!.definition}
          onSave={fromHighlight ? handleSaveNoteFromHighlight : handleSaveNote}
          onClose={() => {
            setPendingNote(null)
            setFromHighlight(null)
            setShowNotePanel(false)
          }}
        />
      )}
    </div>
  )
}
