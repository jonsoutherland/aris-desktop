import { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Highlighter, NotebookPen, X, Search, ListTree, RefreshCw, Trash2, BookOpen } from 'lucide-react'
import { useStore } from '../store'
import type { Highlight, HighlightRect } from '../types'
import NotePanel from './NotePanel'
import HighlightPicker from './HighlightPicker'
import DictionaryPopup from './DictionaryPopup'
import { extractOutline, findOutlineItemForPage } from '../lib/outline'
import { clsx } from 'clsx'
import EpubReader from './EpubReader'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

const PRELOAD_RADIUS = 3   // render pages this far ahead/behind of anything visible
const JUMP_RADIUS = 5      // on explicit page jump, preload this many on each side
const EVICT_RADIUS = 12    // drop rendered canvases further than this from current view

function dedupeRects(rects: HighlightRect[]): HighlightRect[] {
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: HighlightRect[] = []
  for (const r of sorted) {
    if (out.length === 0) { out.push({ ...r }); continue }
    const prev = out[out.length - 1]
    const sameRow = Math.abs(r.y - prev.y) < Math.max(r.height, prev.height) * 0.5
    if (sameRow) {
      const x1 = Math.max(prev.x + prev.width, r.x + r.width)
      const y1 = Math.max(prev.y + prev.height, r.y + r.height)
      prev.x = Math.min(prev.x, r.x)
      prev.y = Math.min(prev.y, r.y)
      prev.width  = x1 - prev.x
      prev.height = y1 - prev.y
    } else {
      const prevBottom = prev.y + prev.height
      const clipped = r.y < prevBottom
        ? { ...r, y: prevBottom, height: r.height - (prevBottom - r.y) }
        : { ...r }
      if (clipped.height > 0.001) out.push(clipped)
    }
  }
  return out
}

interface PageData {
  canvas: HTMLCanvasElement
  width: number
  height: number
  textContent: pdfjsLib.TextContent
  viewport: pdfjsLib.PageViewport
}

interface PendingNote {
  term: string
  termRects: HighlightRect[]
  termPage: number
  definition: string
  definitionRects: HighlightRect[]
  definitionPage: number
}

// Draws the off-screen canvas into a DOM canvas element.
function PageCanvas({ data }: { data: PageData }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    ctx?.drawImage(data.canvas, 0, 0)
  }, [data])
  return <canvas ref={ref} width={data.width} height={data.height} className="absolute inset-0" />
}

// Renders invisible, selectable text spans over the canvas using PDF.js's TextLayer class.
function TextLayer({ data, cursorText }: { data: PageData; cursorText: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const layer = new pdfjsLib.TextLayer({
      textContentSource: data.textContent,
      container: el,
      viewport: data.viewport,
    })
    layer.render()
    return () => layer.cancel()
  }, [data])

  return (
    <div
      ref={ref}
      className="pdf-text-layer"
      style={{
        cursor: cursorText ? 'text' : 'auto',
        // PDF.js v4 reads --scale-factor to compute per-span letter-spacing.
        // Without it, click hit-testing lands several characters off the visible glyph.
        ['--scale-factor' as string]: data.viewport.scale,
      }}
    />
  )
}

export default function Reader() {
  const {
    activeSourceId,
    sources,
    highlights,
    highlightTypes,
    activeHighlightTypeId,
    activePage,
    setActivePage,
    loadHighlights,
    loadNotes,
    notes,
    addHighlight,
    deleteHighlight,
    addNote,
    deleteNote,
    updateSourcePage,
    outline,
    loadOutline,
    saveOutline,
    addVocabWord,
  } = useStore()

  type UndoAction =
    | { type: 'highlight'; id: string }
    | { type: 'note'; noteId: string; highlightId: string }
  const undoStack = useRef<UndoAction[]>([])

  const source = sources.find((s) => s.id === activeSourceId)

  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [pageData, setPageData] = useState<Map<number, PageData>>(new Map())
  // Default placeholder dims — set from page 1 viewport before rendering so the scroll bar is accurate
  const [defaultDims, setDefaultDims] = useState({ width: 680, height: 880 })

  // Render queue — all manipulated through refs to avoid stale closures
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const scaleRef = useRef(1.2)
  const totalPagesRef = useRef(0)
  const activePageRef = useRef(1)
  const renderedSetRef = useRef<Set<number>>(new Set())    // pages with valid canvas data
  const renderingRef = useRef<Set<number>>(new Set())     // pages currently mid-render
  const queueRef = useRef<number[]>([])
  const processingRef = useRef(false)

  // Sync mutable refs
  useEffect(() => { pdfRef.current = pdf }, [pdf])
  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { totalPagesRef.current = totalPages }, [totalPages])
  useEffect(() => { activePageRef.current = activePage }, [activePage])

  // Resume position — once the page divs exist for this freshly loaded PDF,
  // jump to the page we last left off on. Use 'auto' so it's instant on open.
  useEffect(() => {
    if (totalPages === 0) return
    // Wait one frame so page-element ref callbacks have populated pageRefs and
    // placeholder heights are in the DOM (needed for accurate scrollHeight).
    const raf = requestAnimationFrame(() => {
      const containerEl = containerRef.current
      if (!containerEl) return
      const fraction = pendingScrollFractionRef.current
      if (fraction !== null && fraction > 0) {
        containerEl.scrollTop = fraction * containerEl.scrollHeight
      } else if (pendingResumeRef.current !== null) {
        const el = pageRefs.current.get(pendingResumeRef.current)
        if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
      pendingResumeRef.current = null
      pendingScrollFractionRef.current = null
    })
    return () => cancelAnimationFrame(raf)
  }, [totalPages])

  // Note-taking state
  // notePhase: null = idle; 'waitingDefinition' = term captured, waiting for user to drag definition
  const [notePhase, setNotePhase] = useState<null | 'waitingDefinition'>(null)
  const [pendingTerm, setPendingTerm] = useState<{ text: string; rects: HighlightRect[]; page: number } | null>(null)
  const [showNotePanel, setShowNotePanel] = useState(false)
  const [pendingNote, setPendingNote] = useState<PendingNote | null>(null)
  const [fromHighlight, setFromHighlight] = useState<Highlight | null>(null)
  const [highlightMenu, setHighlightMenu] = useState<{
    highlight: Highlight
    pageNum: number
    top: number
    left: number
  } | null>(null)
  const [showHighlightPicker, setShowHighlightPicker] = useState(false)
  const [showNotesSidebar, setShowNotesSidebar] = useState(false)
  const [notesSidebarQuery, setNotesSidebarQuery] = useState('')
  const [showOutlineSidebar, setShowOutlineSidebar] = useState(false)
  const [dictEntry, setDictEntry] = useState<{
    word: string
    anchorX: number
    anchorTop: number
    anchorBottom: number
  } | null>(null)
  const [hoverUnderline, setHoverUnderline] = useState<{ left: number; top: number; width: number; key: number } | null>(null)
  const hoverKeyRef = useRef(0)

  const [dblClickMenu, setDblClickMenu] = useState<{
    word: string
    rects: HighlightRect[]
    page: number
    anchorX: number
    anchorTop: number
    anchorBottom: number
  } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const selectionStartPageRef = useRef<number | null>(null)
  const dblclickStartRef = useRef<{ x: number; y: number } | null>(null)
  const cursorIndicatorRef = useRef<HTMLDivElement>(null)
  const notePhaseRef = useRef<null | 'waitingDefinition'>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const wordHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wordHoverWordRef = useRef<string | null>(null)
  // Set when a PDF loads with a saved position; consumed by the effect below
  // once the placeholder page divs exist in the DOM.
  const pendingResumeRef = useRef<number | null>(null)
  const pendingScrollFractionRef = useRef<number | null>(null)

  useEffect(() => { notePhaseRef.current = notePhase }, [notePhase])

  // Hide cursor indicator when returning to idle
  useEffect(() => {
    if (notePhase === null && cursorIndicatorRef.current) {
      cursorIndicatorRef.current.style.opacity = '0'
    }
  }, [notePhase])

  const cancelNote = () => {
    setNotePhase(null)
    setPendingTerm(null)
    if (cursorIndicatorRef.current) cursorIndicatorRef.current.style.opacity = '0'
  }

  const clearWordHoverTimer = () => {
    if (wordHoverTimerRef.current) {
      clearTimeout(wordHoverTimerRef.current)
      wordHoverTimerRef.current = null
    }
    wordHoverWordRef.current = null
    setHoverUnderline(null)
  }

  const handlePageMouseMove = (e: React.MouseEvent) => {
    if (notePhaseRef.current !== null || dblClickMenu) return
    const caret = document.caretRangeFromPoint(e.clientX, e.clientY)
    if (!caret) { clearWordHoverTimer(); return }
    const wordRange = findWordRange(caret)
    if (!wordRange) { clearWordHoverTimer(); return }
    const word = wordRange.toString().replace(/[^a-zA-Z''-]/g, '')
    if (!word) { clearWordHoverTimer(); return }

    const rect = wordRange.getBoundingClientRect()
    const anchorX = (rect.left + rect.right) / 2
    const anchorTop = rect.top
    const anchorBottom = rect.bottom

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
    setHoverUnderline({ left: rect.left, top: rect.bottom + 1, width: rect.width, key: hoverKeyRef.current })
    wordHoverTimerRef.current = setTimeout(() => {
      setHoverUnderline(null)
      setDictEntry({ word, anchorX, anchorTop, anchorBottom })
      wordHoverTimerRef.current = null
    }, 3000)
  }

  // Close highlight context menu when clicking outside it
  useEffect(() => {
    if (!highlightMenu) return
    const close = (e: MouseEvent) => {
      const popup = document.getElementById('hl-ctx-menu')
      if (popup && !popup.contains(e.target as Node)) setHighlightMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [highlightMenu])

  // Close double-click action menu on outside click or Escape
  useEffect(() => {
    if (!dblClickMenu) return
    const onMouse = (e: MouseEvent) => {
      const el = document.getElementById('dbl-click-menu')
      if (el && !el.contains(e.target as Node)) setDblClickMenu(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDblClickMenu(null) }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [dblClickMenu])

  // Escape cancels note-taking
  useEffect(() => {
    if (notePhase === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelNote() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [notePhase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Z — undo last highlight or note (skips inputs/textareas)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== 'z') return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      e.preventDefault()
      if (notePhaseRef.current !== null) {
        cancelNote()
        return
      }
      const action = undoStack.current.pop()
      if (!action) return
      if (action.type === 'highlight') {
        deleteHighlight(action.id)
      } else {
        deleteNote(action.noteId)
        deleteHighlight(action.highlightId)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [deleteHighlight, deleteNote]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render engine ──────────────────────────────────────────────────────────

  // renderPage is stable — only uses refs, not state
  const renderPage = useCallback(async (pageNum: number): Promise<void> => {
    const currentPdf = pdfRef.current
    if (!currentPdf) return
    const page = await currentPdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: scaleRef.current })
    const offscreen = document.createElement('canvas')
    offscreen.width = viewport.width
    offscreen.height = viewport.height
    // Render canvas pixels and fetch text content in parallel
    const [textContent] = await Promise.all([
      page.getTextContent(),
      page.render({ canvasContext: offscreen.getContext('2d')!, viewport }).promise,
    ])
    setPageData((prev) =>
      new Map(prev).set(pageNum, {
        canvas: offscreen,
        width: viewport.width,
        height: viewport.height,
        textContent,
        viewport,
      })
    )
    renderedSetRef.current.add(pageNum)
  }, [])

  // processQueue drains one page at a time
  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    processingRef.current = true
    while (queueRef.current.length > 0) {
      const pageNum = queueRef.current.shift()!
      if (renderedSetRef.current.has(pageNum) || renderingRef.current.has(pageNum)) continue
      renderingRef.current.add(pageNum)
      await renderPage(pageNum)
      renderingRef.current.delete(pageNum)
    }
    processingRef.current = false
  }, [renderPage])

  // enqueueAround: add pages within radius of center to the queue.
  // Pages are ordered closest-first: center, center+1, center-1, center+2, center-2, …
  // priority=true pushes them to the front, displacing any lower-priority work.
  const enqueueAround = useCallback(
    (center: number, radius: number, priority = false) => {
      const pages: number[] = []
      for (let delta = 0; delta <= radius; delta++) {
        if (center + delta <= totalPagesRef.current) pages.push(center + delta)
        if (delta > 0 && center - delta >= 1) pages.push(center - delta)
      }
      const toAdd = pages.filter(
        (p) => !renderedSetRef.current.has(p) && !renderingRef.current.has(p)
      )
      if (priority) {
        queueRef.current = queueRef.current.filter((p) => !toAdd.includes(p))
        queueRef.current.unshift(...toAdd)
      } else {
        for (const p of toAdd) {
          if (!queueRef.current.includes(p)) queueRef.current.push(p)
        }
      }
      processQueue()
    },
    [processQueue]
  )

  // evictFarPages: drop rendered canvas data for pages far from current view
  const evictFarPages = useCallback((currentPage: number) => {
    setPageData((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const [p] of prev) {
        if (Math.abs(p - currentPage) > EVICT_RADIUS) {
          next.delete(p)
          renderedSetRef.current.delete(p)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  // ── PDF loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!source || source.type !== 'pdf') return
    let cancelled = false

    const load = async () => {
      const loaded = await pdfjsLib.getDocument({ url: `file://${source.file_path}` }).promise
      if (cancelled) return

      pdfRef.current = loaded
      totalPagesRef.current = loaded.numPages
      setPdf(loaded)
      setTotalPages(loaded.numPages)

      await window.api.db.run(
        'UPDATE knowledge_sources SET total_pages = ? WHERE id = ?',
        [loaded.numPages, source.id]
      )

      // Measure page 1 to set accurate placeholder dimensions before any rendering
      const p1 = await loaded.getPage(1)
      const vp1 = p1.getViewport({ scale: scaleRef.current })
      if (!cancelled) setDefaultDims({ width: vp1.width, height: vp1.height })

      const startPage = Math.max(1, Math.min(loaded.numPages, source.current_page ?? 1))
      setActivePage(startPage)
      activePageRef.current = startPage
      pendingResumeRef.current = startPage > 1 ? startPage : null
      pendingScrollFractionRef.current = source.scroll_fraction ?? null
      enqueueAround(startPage, JUMP_RADIUS, true)
    }

    load()

    return () => {
      cancelled = true
      setPdf(null)
      pdfRef.current = null
      setPageData(new Map())
      renderedSetRef.current.clear()
      renderingRef.current.clear()
      queueRef.current = []
      processingRef.current = false
    }
  }, [source?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Highlights ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (activeSourceId) {
      loadHighlights(activeSourceId)
      loadNotes(activeSourceId)
      loadOutline(activeSourceId)
    }
  }, [activeSourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extract outline once after PDF loads, if we don't already have one stored.
  // Run async in the background — outline parsing can take a few seconds for big PDFs.
  useEffect(() => {
    if (!pdf || !activeSourceId) return
    let cancelled = false
    ;(async () => {
      // If there's already a stored outline for this source, skip extraction
      const existing = await window.api.db.all<{ c: number }>(
        'SELECT COUNT(*) as c FROM source_outline_items WHERE source_id = ?',
        [activeSourceId]
      )
      if (cancelled) return
      if ((existing[0]?.c ?? 0) > 0) return
      try {
        const items = await extractOutline(pdf, activeSourceId)
        if (cancelled) return
        if (items.length > 0) await saveOutline(activeSourceId, items)
      } catch (err) {
        console.warn('Outline extraction failed', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdf, activeSourceId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [refreshingOutline, setRefreshingOutline] = useState(false)
  const refreshOutline = async () => {
    if (!pdf || !activeSourceId || refreshingOutline) return
    setRefreshingOutline(true)
    try {
      const items = await extractOutline(pdf, activeSourceId)
      await saveOutline(activeSourceId, items)
    } catch (err) {
      console.warn('Outline refresh failed', err)
    } finally {
      setRefreshingOutline(false)
    }
  }

  // ── IntersectionObserver ───────────────────────────────────────────────────

  // IntersectionObserver is used only for render-queue housekeeping (preload
  // pages near the viewport, evict ones far away). Active-page tracking lives
  // in the scroll-driven effect below — IntersectionObserver's rootMargin
  // makes it report multiple pages as "intersecting" simultaneously, which
  // produced wrong activePage values (e.g. defaulting to 2 at scroll=0).
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const pageNum = parseInt((entry.target as HTMLElement).dataset.page ?? '0')
        if (!pageNum) continue
        enqueueAround(pageNum, PRELOAD_RADIUS)
        evictFarPages(pageNum)
      }
    },
    [enqueueAround, evictFarPages]
  )

  // (Re-)create observer when pdf loads or when the callback identity changes.
  // After creation, observe all existing page divs; new divs self-register via their ref callback.
  useEffect(() => {
    if (!pdf || totalPages === 0 || !containerRef.current) return

    observerRef.current?.disconnect()
    const observer = new IntersectionObserver(handleIntersect, {
      root: containerRef.current,
      rootMargin: '500px 0px 500px 0px', // start loading well before pages enter view
      threshold: 0,
    })
    observerRef.current = observer
    pageRefs.current.forEach((el) => observer.observe(el))

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [pdf, totalPages, handleIntersect])

  // ── Active-page tracking ──────────────────────────────────────────────────
  // Pick the page with the largest visible area in the actual viewport on
  // every scroll. rAF-coalesced so it's one update per frame at most.
  useEffect(() => {
    const containerEl = containerRef.current
    if (!pdf || totalPages === 0 || !containerEl) return

    let raf: number | null = null
    let saveTimer: ReturnType<typeof setTimeout> | null = null

    const update = () => {
      raf = null
      const containerRect = containerEl.getBoundingClientRect()
      let bestPage: number | null = null
      let bestVisible = 0
      pageRefs.current.forEach((el, pageNum) => {
        const r = el.getBoundingClientRect()
        const visibleTop = Math.max(r.top, containerRect.top)
        const visibleBottom = Math.min(r.bottom, containerRect.bottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)
        if (visibleHeight > bestVisible) {
          bestVisible = visibleHeight
          bestPage = pageNum
        }
      })
      if (bestPage !== null && bestPage !== activePageRef.current) {
        setActivePage(bestPage)
        activePageRef.current = bestPage
      }
    }

    const onScroll = () => {
      if (raf !== null) return
      raf = requestAnimationFrame(update)
      // Debounce the DB write so it fires ~300ms after scrolling stops
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        const fraction = containerEl.scrollHeight > containerEl.clientHeight
          ? containerEl.scrollTop / containerEl.scrollHeight
          : 0
        if (activeSourceId) updateSourcePage(activeSourceId, activePageRef.current, fraction)
        saveTimer = null
      }, 300)
    }

    containerEl.addEventListener('scroll', onScroll, { passive: true })
    // Sync once on mount so we don't sit at a stale activePage
    raf = requestAnimationFrame(update)

    return () => {
      containerEl.removeEventListener('scroll', onScroll)
      if (raf !== null) cancelAnimationFrame(raf)
      if (saveTimer !== null) clearTimeout(saveTimer)
    }
  }, [pdf, totalPages, activeSourceId, updateSourcePage, setActivePage])

  // ── Scale change ───────────────────────────────────────────────────────────

  const handleScaleChange = useCallback(
    (delta: number) => {
      const newScale = Math.max(0.5, Math.min(3, scaleRef.current + delta))
      if (newScale === scaleRef.current) return
      scaleRef.current = newScale
      setScale(newScale)

      // Remeasure page 1 for new placeholder dimensions
      if (pdfRef.current) {
        pdfRef.current.getPage(1).then((p) => {
          const vp = p.getViewport({ scale: newScale })
          setDefaultDims({ width: vp.width, height: vp.height })
        })
      }

      // Clear all rendered canvases; IntersectionObserver will re-trigger rendering
      setPageData(new Map())
      renderedSetRef.current.clear()
      renderingRef.current.clear()
      queueRef.current = []
      processingRef.current = false
      enqueueAround(activePageRef.current, JUMP_RADIUS, true)
    },
    [enqueueAround]
  )

  // Ctrl+wheel zoom — bind a non-passive native listener so preventDefault() actually
  // suppresses the browser's page zoom. Accumulate wheel deltas across one rAF tick so
  // a single burst of wheel events triggers at most one re-render of the page canvases.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let accum = 0
    let raf: number | null = null
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      accum += e.deltaY
      if (raf !== null) return
      raf = requestAnimationFrame(() => {
        raf = null
        const local = accum
        accum = 0
        // 100 deltaY ≈ one notch ≈ 0.1 zoom step; cap per-frame step at 0.4
        const step = Math.max(-0.4, Math.min(0.4, -local / 1000))
        if (Math.abs(step) >= 0.01) handleScaleChange(step)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [handleScaleChange])

  // ── Page navigation ────────────────────────────────────────────────────────

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(totalPagesRef.current, page))
      setActivePage(clamped)
      activePageRef.current = clamped
      if (activeSourceId) updateSourcePage(activeSourceId, clamped)

      // Reprioritize render queue around jump target
      queueRef.current = []
      enqueueAround(clamped, JUMP_RADIUS, true)

      pageRefs.current.get(clamped)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [enqueueAround, activeSourceId, updateSourcePage]
  )

  // ── Keyboard navigation ────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!pdf) return
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement)?.isContentEditable
      ) return
      if (notePhaseRef.current !== null) return

      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          if (e.ctrlKey || e.altKey || e.metaKey) return
          e.preventDefault()
          goToPage(activePageRef.current + 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          if (e.ctrlKey || e.altKey || e.metaKey) return
          e.preventDefault()
          goToPage(activePageRef.current - 1)
          break
        case ' ':
          e.preventDefault()
          goToPage(activePageRef.current + (e.shiftKey ? -1 : 1))
          break
        case 'Home':
          if (e.ctrlKey || e.altKey) return
          e.preventDefault()
          goToPage(1)
          break
        case 'End':
          if (e.ctrlKey || e.altKey) return
          e.preventDefault()
          goToPage(totalPagesRef.current)
          break
        case '=':
        case '+':
          if (!e.ctrlKey) return
          e.preventDefault()
          handleScaleChange(0.1)
          break
        case '-':
          if (!e.ctrlKey) return
          e.preventDefault()
          handleScaleChange(-0.1)
          break
        case '0':
          if (!e.ctrlKey) return
          e.preventDefault()
          handleScaleChange(1.2 - scaleRef.current)
          break
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pdf, goToPage, handleScaleChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Text selection + note-taking ───────────────────────────────────────────

  // Uses range.getClientRects() so highlight rects match the browser's actual rendered
  // glyph positions — proportional fonts and CSS transforms are handled for free.
  const normalizeSelectedText = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

  const getSelectionRects = (containerEl: HTMLElement, _pageNum: number): HighlightRect[] => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return []
    const range = sel.getRangeAt(0)

    const containerBox = containerEl.getBoundingClientRect()
    if (containerBox.width <= 0 || containerBox.height <= 0) return []

    const rects: HighlightRect[] = []
    for (const cr of Array.from(range.getClientRects())) {
      if (cr.width <= 0 || cr.height <= 0) continue

      const x = (cr.left - containerBox.left) / containerBox.width
      const y = (cr.top  - containerBox.top)  / containerBox.height
      const w = cr.width  / containerBox.width
      const h = cr.height / containerBox.height

      // Clamp to page bounds so a stray rect (e.g. selection edge past margin) can't escape
      const nx = Math.max(0, Math.min(1, x))
      const ny = Math.max(0, Math.min(1, y))
      const nw = Math.max(0, Math.min(1 - nx, w - (nx - x)))
      const nh = Math.max(0, Math.min(1 - ny, h - (ny - y)))

      if (nw >= 0.001 && nh >= 0.001) {
        rects.push({ x: nx, y: ny, width: nw, height: nh, pageIndex: 0 })
      }
    }

    // getClientRects() returns one rect per PDF.js text span. Adjacent spans can carry a
    // subpixel y-overlap from floating-point glyph positioning, so two highlight divs paint
    // the same pixel row and make it appear darker. Fix in two passes:
    //   1. Sort top→bottom, merge rects that share the same visual row.
    //   2. Clip the top of any remaining rect that still overlaps the row above it.
    rects.sort((a, b) => a.y - b.y || a.x - b.x)
    const out: HighlightRect[] = []
    for (const r of rects) {
      if (out.length === 0) { out.push({ ...r }); continue }
      const prev = out[out.length - 1]
      const sameRow = Math.abs(r.y - prev.y) < Math.max(r.height, prev.height) * 0.5
      if (sameRow) {
        // Same line — extend the existing rect to cover both
        const x1 = Math.max(prev.x + prev.width, r.x + r.width)
        const y1 = Math.max(prev.y + prev.height, r.y + r.height)
        prev.x = Math.min(prev.x, r.x)
        prev.y = Math.min(prev.y, r.y)
        prev.width  = x1 - prev.x
        prev.height = y1 - prev.y
      } else {
        // Different line — clip top so it doesn't overlap the previous row's bottom
        const prevBottom = prev.y + prev.height
        const clipped = r.y < prevBottom
          ? { ...r, y: prevBottom, height: r.height - (prevBottom - r.y) }
          : { ...r }
        if (clipped.height > 0.001) out.push(clipped)
      }
    }
    return out
  }

  const handlePageMouseDown = (pageNum: number, e: React.MouseEvent) => {
    selectionStartPageRef.current = pageNum
    // Dismiss popups and cancel hover timer when the user starts a new interaction
    if (dictEntry) setDictEntry(null)
    if (dblClickMenu) setDblClickMenu(null)
    clearWordHoverTimer()
    // Record start of potential double-click drag for snap-free term selection
    if (e.detail === 2) dblclickStartRef.current = { x: e.clientX, y: e.clientY }
  }

  // Expand a caret position outward to the nearest word boundaries within its text node.
  const findWordRange = (caretRange: Range): Range | null => {
    const node = caretRange.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return null
    const text = node.textContent ?? ''
    let start = caretRange.startOffset
    let end = start
    while (start > 0 && !/[\s ]/.test(text[start - 1])) start--
    while (end < text.length && !/[\s ]/.test(text[end])) end++
    if (start >= end) return null
    const r = document.createRange()
    r.setStart(node, start)
    r.setEnd(node, end)
    return r
  }

  // Double-click + hold + drag captures the term.
  // We use caretRangeFromPoint at both the press-start and the release point so the
  // selection is character-precise instead of browser-snapped-to-word.
  const handlePageDoubleClick = (pageNum: number, containerEl: HTMLElement, endX: number, endY: number) => {
    const sel = window.getSelection()
    let usedRange: Range | null = null

    const startPos = dblclickStartRef.current
    dblclickStartRef.current = null

    if (startPos) {
      const startCaret = document.caretRangeFromPoint(startPos.x, startPos.y)
      const endCaret = document.caretRangeFromPoint(endX, endY)

      if (startCaret && endCaret) {
        const startIsText = startCaret.startContainer.nodeType === Node.TEXT_NODE
        const endIsText = endCaret.startContainer.nodeType === Node.TEXT_NODE

        if (startIsText && endIsText) {
          // Both carets on real text — build range and snap to word boundaries.
          // If either caret resolved to a non-text container (e.g. the PDF.js wrapper
          // div when the cursor lands on empty space between line spans), the offset
          // becomes a child-element index rather than a character offset. That corrupts
          // compareBoundaryPoints and can flip the range to start at position 0 of the
          // entire page. Guard here prevents that path entirely.
          const r = document.createRange()
          const cmp = startCaret.compareBoundaryPoints(Range.START_TO_START, endCaret)
          if (cmp <= 0) {
            r.setStart(startCaret.startContainer, startCaret.startOffset)
            r.setEnd(endCaret.startContainer, endCaret.startOffset)
          } else {
            r.setStart(endCaret.startContainer, endCaret.startOffset)
            r.setEnd(startCaret.startContainer, startCaret.startOffset)
          }

          if (r.collapsed) {
            // Plain double-click (no drag) — select the whole word
            usedRange = findWordRange(endCaret) ?? null
          } else {
            // Drag — snap start backward to word-beginning and end forward to word-end.
            // Both containers are guaranteed TEXT_NODE here so no inner nodeType check needed.
            const startNode = r.startContainer as Text
            let startOff = r.startOffset
            const t1 = startNode.textContent ?? ''
            while (startOff > 0 && !/\s/.test(t1[startOff - 1])) startOff--

            const endNode = r.endContainer as Text
            let endOff = r.endOffset
            const t2 = endNode.textContent ?? ''
            while (endOff < t2.length && !/\s/.test(t2[endOff])) endOff++

            const snapped = document.createRange()
            snapped.setStart(startNode, startOff)
            snapped.setEnd(endNode, endOff)
            usedRange = snapped
          }
        } else if (startIsText) {
          // End caret landed on empty space (non-text node) — fall back to the word
          // at the double-click start rather than producing a corrupted range.
          usedRange = findWordRange(startCaret) ?? null
        }
      }
    }

    // Final fallback: whatever the browser selected
    if (!usedRange && sel && sel.rangeCount > 0) usedRange = sel.getRangeAt(0)
    if (!usedRange) return

    // Apply range so getSelectionRects can walk it
    sel?.removeAllRanges()
    sel?.addRange(usedRange)

    const text = normalizeSelectedText(usedRange.toString())
    if (!text) { sel?.removeAllRanges(); return }
    const rects = getSelectionRects(containerEl, pageNum)
    const selRect = usedRange.getBoundingClientRect()
    sel?.removeAllRanges()
    if (rects.length === 0) return

    setDblClickMenu({
      word: text,
      rects,
      page: pageNum,
      anchorX: (selRect.left + selRect.right) / 2,
      anchorTop: selRect.top,
      anchorBottom: selRect.bottom,
    })
  }

  // clickDetail mirrors MouseEvent.detail: 1 = single-click mouseup, 2 = second-click of a
  // double-click. We skip detail===2 because dblclick (fired right after) handles that case.
  const handlePageMouseUp = async (
    pageNum: number,
    containerEl: HTMLElement,
    clickDetail: number,
  ) => {
    if (clickDetail === 2) return

    // Block cross-page selections — they produce garbled rects
    if (selectionStartPageRef.current !== null && selectionStartPageRef.current !== pageNum) {
      window.getSelection()?.removeAllRanges()
      return
    }

    const selection = window.getSelection()
    const text = normalizeSelectedText(selection?.toString() ?? '')
    if (!text) return
    const rects = getSelectionRects(containerEl, pageNum)
    if (rects.length === 0) return

    if (notePhase === 'waitingDefinition' && pendingTerm) {
      setPendingNote({
        term: pendingTerm.text,
        termRects: pendingTerm.rects,
        termPage: pendingTerm.page,
        definition: text,
        definitionRects: rects,
        definitionPage: pageNum,
      })
      setNotePhase(null)
      setPendingTerm(null)
      setShowNotePanel(true)
    } else if (notePhase === null) {
      const hl = await addHighlight(activeSourceId!, pageNum, text, rects)
      undoStack.current.push({ type: 'highlight', id: hl.id })
    }
    selection?.removeAllRanges()
  }

  const handleSaveNote = async (term: string, definition: string) => {
    if (!activeSourceId || !pendingNote) return
    const termHighlight = await addHighlight(
      activeSourceId,
      pendingNote.termPage,
      pendingNote.term,
      pendingNote.termRects
    )
    const section = findOutlineItemForPage(outline, pendingNote.termPage)
    const note = await addNote(activeSourceId, term, definition, {
      highlightId: termHighlight.id,
      page: pendingNote.termPage,
      outlineItemId: section?.id,
      chapter: section?.title,
    })
    undoStack.current.push({ type: 'note', noteId: note.id, highlightId: termHighlight.id })
    setPendingNote(null)
    setShowNotePanel(false)
  }

  const handleSaveNoteFromHighlight = async (term: string, definition: string) => {
    if (!activeSourceId || !fromHighlight) return
    const section = findOutlineItemForPage(outline, fromHighlight.page_number)
    await addNote(activeSourceId, term, definition, {
      highlightId: fromHighlight.id,
      page: fromHighlight.page_number,
      outlineItemId: section?.id,
      chapter: section?.title,
    })
    setFromHighlight(null)
    setShowNotePanel(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!source) {
    return (
      <div className="flex items-center justify-center h-full text-lavender/40 flex-col gap-3">
        <FileText size={48} strokeWidth={1} />
        <p className="text-sm">No document open</p>
      </div>
    )
  }

  if (source.type === 'epub') {
    return <EpubReader />
  }

  const activeType = highlightTypes.find((t) => t.id === activeHighlightTypeId)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Outline sidebar (left) */}
      {showOutlineSidebar && (
        <aside className="w-72 shrink-0 border-r border-white/5 bg-ink flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <h2 className="text-sm font-medium text-blush flex items-center gap-2">
              <ListTree size={14} className="text-ocean" />
              Outline
              <span className="text-lavender/40 text-xs">({outline.length})</span>
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={refreshOutline}
                disabled={refreshingOutline || !pdf}
                title="Re-extract outline from this document"
                className="p-1 text-lavender/40 hover:text-blush transition-colors rounded disabled:opacity-40"
              >
                <RefreshCw size={13} className={refreshingOutline ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowOutlineSidebar(false)}
                className="p-1 text-lavender/40 hover:text-blush transition-colors rounded"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {outline.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-lavender/40">
                No outline detected for this document.
              </div>
            ) : (
              <ul>
                {outline.map((it) => {
                  const active = findOutlineItemForPage(outline, activePage)?.id === it.id
                  return (
                    <li key={it.id}>
                      <button
                        onClick={() => goToPage(it.page_number)}
                        className={clsx(
                          'w-full text-left px-3 py-1.5 text-xs transition-colors flex items-baseline gap-2',
                          active
                            ? 'bg-ocean/15 text-blush'
                            : 'text-lavender/70 hover:bg-white/5'
                        )}
                        style={{ paddingLeft: `${12 + it.depth * 14}px` }}
                      >
                        <span className="flex-1 truncate">{it.title}</span>
                        <span className="text-[10px] text-lavender/40 shrink-0">
                          {it.page_number}
                        </span>
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
                : 'text-lavender/50 hover:text-blush hover:bg-white/5'
            )}
            title="Toggle outline"
          >
            <ListTree size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          <button
            onClick={() => goToPage(activePage - 1)}
            disabled={activePage <= 1}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-1.5 text-xs text-lavender/60">
            <input
              type="number"
              value={activePage}
              onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
              className="w-12 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-center text-blush outline-none focus:border-ocean/50"
            />
            <span>/ {totalPages}</span>
          </div>
          <button
            onClick={() => goToPage(activePage + 1)}
            disabled={activePage >= totalPages}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          <button
            onClick={() => handleScaleChange(-0.1)}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 transition-colors"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-lavender/50 w-10 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => handleScaleChange(0.1)}
            className="p-1.5 rounded text-lavender/50 hover:text-blush hover:bg-white/5 transition-colors"
          >
            <ZoomIn size={16} />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Note-taking status — only visible while waiting for definition */}
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

          {/* Notes-for-reference sidebar toggle */}
          <button
            onClick={() => setShowNotesSidebar((v) => !v)}
            className={clsx(
              'flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg transition-colors',
              showNotesSidebar
                ? 'bg-ocean/20 text-ocean'
                : 'bg-white/5 text-lavender/70 hover:bg-white/10'
            )}
            title="Show notes for reference"
          >
            <NotebookPen size={13} />
            <span>Notes</span>
          </button>
        </div>

        {/* Page container — all pages always in DOM for accurate scroll; only rendered pages get canvases */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-6"
          onMouseMove={(e) => {
            const el = cursorIndicatorRef.current
            if (!el || notePhaseRef.current === null) return
            el.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 8}px)`
            el.style.opacity = '1'
          }}
          onMouseLeave={() => {
            if (cursorIndicatorRef.current) cursorIndicatorRef.current.style.opacity = '0'
            clearWordHoverTimer()
          }}
        >
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
            const data = pageData.get(pageNum)
            const pageHighlights = highlights.filter((h) => h.page_number === pageNum)
            const w = data?.width ?? defaultDims.width
            const h = data?.height ?? defaultDims.height
            const nearCurrent = Math.abs(pageNum - activePage) <= PRELOAD_RADIUS + 1

            return (
              <div
                key={pageNum}
                ref={(el) => {
                  if (el) {
                    pageRefs.current.set(pageNum, el)
                    observerRef.current?.observe(el)
                  } else {
                    const prev = pageRefs.current.get(pageNum)
                    if (prev) observerRef.current?.unobserve(prev)
                    pageRefs.current.delete(pageNum)
                  }
                }}
                data-page={pageNum}
                className="relative shadow-2xl shrink-0 select-none"
                style={{ width: w, height: h, backgroundColor: '#fff' }}
                onMouseDown={(e) => handlePageMouseDown(pageNum, e)}
                onMouseMove={handlePageMouseMove}
                onDoubleClick={(e) => {
                  const el = pageRefs.current.get(pageNum)
                  if (el) handlePageDoubleClick(pageNum, el, e.clientX, e.clientY)
                }}
                onMouseUp={(e) => {
                  const el = pageRefs.current.get(pageNum)
                  if (el) handlePageMouseUp(pageNum, el, e.detail)
                }}
              >
                {/* Rendered canvas */}
                {data && <PageCanvas data={data} />}

                {/* Text layer — invisible spans that make the PDF text selectable */}
                {data && <TextLayer data={data} cursorText={notePhase !== null} />}

                {/* Loading spinner — only shown for pages near current view */}
                {!data && nearCurrent && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white">
                    <div className="w-6 h-6 border-2 border-ocean/30 border-t-ocean rounded-full animate-spin" />
                  </div>
                )}

                {/* Highlight overlay */}
                {pageHighlights.length > 0 && (
                  <div className="pdf-highlight-layer">
                    {pageHighlights.map((hl) =>
                      dedupeRects(hl.rects).map((rect, ri) => (
                        <div
                          key={`${hl.id}-${ri}`}
                          className="pdf-highlight-rect"
                          style={{
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `${rect.height * 100}%`,
                            backgroundColor: hl.highlight_type?.color ?? '#2978a0',
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                          }}
                          title={hl.selected_text}
                          onClick={(e) => {
                            e.stopPropagation()
                            const firstRect = dedupeRects(hl.rects)[0]
                            setHighlightMenu({
                              highlight: hl,
                              pageNum,
                              top: firstRect.y * 100,
                              left: firstRect.x * 100,
                            })
                          }}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Highlight context menu */}
                {highlightMenu?.pageNum === pageNum && (
                  <div
                    id="hl-ctx-menu"
                    className="absolute z-20 bg-ink border border-white/15 rounded-lg shadow-xl overflow-hidden"
                    style={{
                      left: `${highlightMenu.left}%`,
                      bottom: `calc(${100 - highlightMenu.top}% + 6px)`,
                      transform: 'translateX(-20%)',
                    }}
                  >
                    <button
                      className="flex items-center gap-2 px-3 py-2 text-xs text-blush hover:bg-white/8 w-full text-left whitespace-nowrap transition-colors"
                      onClick={() => {
                        setFromHighlight(highlightMenu.highlight)
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
                        const firstWord = highlightMenu.highlight.selected_text.trim().split(/\s+/)[0].replace(/[^a-zA-Z''-]/g, '')
                        const menuEl = document.getElementById('hl-ctx-menu')
                        const r = menuEl?.getBoundingClientRect()
                        if (firstWord) {
                          setDictEntry({
                            word: firstWord,
                            anchorX: r ? (r.left + r.right) / 2 : window.innerWidth / 2,
                            anchorTop: r?.top ?? 200,
                            anchorBottom: r?.bottom ?? 220,
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
                      onClick={() => {
                        deleteHighlight(highlightMenu.highlight.id)
                        setHighlightMenu(null)
                      }}
                    >
                      <Trash2 size={12} />
                      Delete highlight
                    </button>
                  </div>
                )}

                {/* Term badge — floats above the first line of the term so the definition
                    area below stays clear. pointer-events:none means it never blocks a drag;
                    only the ✕ button opts back in so it remains clickable. */}
                {notePhase === 'waitingDefinition' && pendingTerm?.page === pageNum && (() => {
                  const anchor = pendingTerm.rects[0]
                  return (
                    <div
                      className="absolute z-10 flex items-center gap-2 bg-ink border border-sage/40 text-xs px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap"
                      style={{
                        left: `${anchor.x * 100}%`,
                        bottom: `calc(${(1 - anchor.y) * 100}% + 6px)`,
                        pointerEvents: 'none',
                      }}
                    >
                      <span className="text-sage font-medium">
                        &ldquo;{pendingTerm.text.length > 28
                          ? pendingTerm.text.slice(0, 28) + '…'
                          : pendingTerm.text}&rdquo;
                      </span>
                      <span className="text-lavender/40">→</span>
                      <span className="text-lavender/60">drag to select definition</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelNote() }}
                        className="ml-0.5 text-lavender/30 hover:text-lavender/70 transition-colors leading-none"
                        style={{ pointerEvents: 'auto' }}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })()}

                <div className="absolute -bottom-5 left-0 right-0 text-center text-[10px] text-lavender/25 select-none">
                  {pageNum}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Reference notes sidebar — read-only list of existing notes for this source */}
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
                      n.definition.toLowerCase().includes(q)
                  )
                : notes
              if (filtered.length === 0) {
                return (
                  <div className="px-4 py-8 text-center text-xs text-lavender/40">
                    {notes.length === 0
                      ? 'No notes yet for this document.'
                      : 'No matches.'}
                  </div>
                )
              }
              return (
                <ul className="divide-y divide-white/5">
                  {filtered.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => n.page_number && goToPage(n.page_number)}
                        className="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors group"
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <span className="font-medium text-sage text-sm truncate">
                            {n.term}
                          </span>
                          {n.page_number && (
                            <span className="text-[10px] text-lavender/40 shrink-0 group-hover:text-ocean transition-colors">
                              p.{n.page_number}
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

      {dblClickMenu && (() => {
        const MENU_W = 232
        const MENU_H = 56
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
            id="dbl-click-menu"
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
                setPendingTerm({ text: dblClickMenu.word, rects: dblClickMenu.rects, page: dblClickMenu.page })
                setNotePhase('waitingDefinition')
                setDblClickMenu(null)
              }}
            >
              <NotebookPen size={13} className="text-ocean shrink-0" />
              Create note
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

      {dictEntry && (
        <DictionaryPopup
          word={dictEntry.word}
          anchorX={dictEntry.anchorX}
          anchorTop={dictEntry.anchorTop}
          anchorBottom={dictEntry.anchorBottom}
          onClose={() => { setDictEntry(null); clearWordHoverTimer() }}
          onAddVocab={async (word, definition) => {
            await addVocabWord(word, definition)
          }}
        />
      )}

      {showNotePanel && (pendingNote || fromHighlight) && (
        <NotePanel
          initialTerm={fromHighlight ? fromHighlight.selected_text : pendingNote!.term}
          initialDefinition={fromHighlight ? '' : pendingNote!.definition}
          onSave={fromHighlight ? handleSaveNoteFromHighlight : handleSaveNote}
          onClose={() => {
            setPendingNote(null)
            setFromHighlight(null)
            setShowNotePanel(false)
          }}
        />
      )}

      {/* Floating cursor indicator — only visible in waitingDefinition phase, position via DOM */}
      <div
        ref={cursorIndicatorRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          transform: 'translate(0px, 0px)',
          zIndex: 1000,
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.1s',
          willChange: 'transform',
        }}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium shadow-lg border bg-ink border-blush/40 text-blush"
      >
        <span>Drag to select definition</span>
      </div>
    </div>
  )
}
