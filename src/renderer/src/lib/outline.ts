import * as pdfjsLib from 'pdfjs-dist'
import { v4 as uuidv4 } from 'uuid'
import type { OutlineItem } from '../types'

interface ParsedItem {
  title: string
  page: number
  depth: number
}

// ── Embedded outline (pdf.getOutline) ────────────────────────────────────────

interface RawOutlineNode {
  title: string
  dest?: unknown
  url?: string
  items?: RawOutlineNode[]
}

const resolvePageNumber = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  dest: unknown
): Promise<number | null> => {
  if (!dest) return null
  try {
    let resolved: unknown = dest
    if (typeof dest === 'string') {
      resolved = await pdf.getDestination(dest)
    }
    if (!Array.isArray(resolved) || resolved.length === 0) return null
    const ref = resolved[0]
    // pdf.getPageIndex expects a RefProxy; we receive it from the PDF dest array.
    const idx = await pdf.getPageIndex(ref as Parameters<typeof pdf.getPageIndex>[0])
    return idx + 1
  } catch {
    return null
  }
}

const flattenEmbedded = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  nodes: RawOutlineNode[],
  depth: number,
  out: ParsedItem[]
): Promise<void> => {
  for (const n of nodes) {
    const page = await resolvePageNumber(pdf, n.dest)
    if (page !== null) out.push({ title: n.title.trim(), page, depth })
    if (n.items?.length) await flattenEmbedded(pdf, n.items, depth + 1, out)
  }
}

const extractEmbedded = async (pdf: pdfjsLib.PDFDocumentProxy): Promise<ParsedItem[]> => {
  const raw = (await pdf.getOutline()) as RawOutlineNode[] | null
  if (!raw || raw.length === 0) return []
  const items: ParsedItem[] = []
  await flattenEmbedded(pdf, raw, 0, items)
  return items
}

// ── TOC-page scanning ────────────────────────────────────────────────────────
//
// When the document contains a printed Table of Contents, scanning that page
// directly is more reliable than scanning every body-text page: the TOC page
// lays out title/page-number pairs explicitly, with one entry per line.
//
// Strategy:
//   1. Walk the first ~30 pages looking for a "Contents" / "Table of Contents"
//      heading on its own line.
//   2. From that page forward, collect lines that look like TOC entries:
//      "<title>  ......  <page>" or "<title>   <page>" (multi-space gap).
//   3. Stop after we see two consecutive scanned pages without TOC entries
//      (and we've already collected at least a couple of items).
//   4. Depth is derived from numbered prefixes ("1.1" → depth 1, "1.1.1" → 2).

const TOC_HEADER_RE = /^\s*(table\s+of\s+contents|contents)\s*$/i
// PDF.js text extraction collapses dot leaders / wide gaps into a single space,
// so we accept any whitespace between the title and the trailing page number.
// Safety comes from filters in isLikelyTocEntry (must contain letters etc).
const TOC_LINE_RE = /^(.{3,120}?)\s+(\d{1,4})\s*$/
const NUMBERED_PREFIX_RE = /^(\d+(?:\.\d+){0,3})\.?\s+/

const isLikelyTocEntry = (line: string): { title: string; page: number; depth: number } | null => {
  const m = line.match(TOC_LINE_RE)
  if (!m) return null
  const title = m[1].trim()
  const page = parseInt(m[2], 10)
  if (!title || title.length < 3 || page < 1 || page > 9999) return null
  // Reject lines without alphabetic content (e.g. "1.5.2 0" or pure numerics)
  if (!/[A-Za-z]/.test(title)) return null
  // Reject titles that look like sentence fragments — TOC entries are short
  // labels, not running prose ending in a number.
  const letterCount = (title.match(/[A-Za-z]/g) ?? []).length
  if (letterCount < 3) return null
  const prefix = title.match(NUMBERED_PREFIX_RE)
  const depth = prefix ? Math.min(prefix[1].split('.').length - 1, 4) : 0
  return { title, page, depth }
}

// Strip leading section numbering ("1.2 ", "Chapter 3: ") so we can match a TOC
// title against the heading on its actual page even if formatting differs.
const stripLeadingNumber = (s: string): string =>
  s
    .replace(/^\s*(?:chapter|part|section|appendix)\s+[ivxlcdm\d]+\b\s*[:.\-—]?\s*/i, '')
    .replace(/^\s*\d+(?:\.\d+){0,3}\.?\s+/, '')
    // "I Artificial Intelligence" / "VI Communicating ..." — strip a standalone
    // capital Roman numeral followed by a capital-letter word. Case-sensitive
    // on both halves so "I am ...", "It is ..." etc. aren't damaged.
    .replace(/^\s*[IVXLCDM]+\s+(?=[A-Z])/, '')
    .trim()

const titleAppearsOnPage = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  pdfPage: number,
  titleCore: string
): Promise<boolean> => {
  if (titleCore.length < 4) return false
  const target = titleCore.toLowerCase()
  const lines = await collectPageLines(pdf, pdfPage)
  // Chapter/section titles live within the first few lines of their page
  const head = lines.slice(0, 6)
  for (const raw of head) {
    const stripped = stripLeadingNumber(raw.text).toLowerCase()
    if (stripped.length === 0) continue
    if (stripped === target) return true
    if (stripped.length >= 6 && (stripped.includes(target) || target.includes(stripped))) return true
  }
  return false
}

// Find the offset between TOC-printed page numbers and actual PDF page indices.
// Search a few sample chapters; require ≥2 to agree on the same offset.
const detectPageOffset = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  items: ParsedItem[],
  searchAfterPdfPage: number
): Promise<number | null> => {
  const candidates = items
    .filter((it) => stripLeadingNumber(it.title).length >= 4)
    .sort((a, b) => a.depth - b.depth || a.page - b.page)
    .slice(0, 6)
  console.log(
    `[outline] offset: searching with ${candidates.length} samples, starting after PDF page ${searchAfterPdfPage}`
  )
  if (candidates.length < 2) {
    console.log('[outline] offset: not enough candidate samples to be confident')
    return null
  }

  const offsets: number[] = []
  let estimatedOffset: number | null = null
  for (const entry of candidates) {
    const core = stripLeadingNumber(entry.title)
    let start: number
    let end: number
    if (estimatedOffset !== null) {
      // Once we have a rough estimate, search a tight window around it —
      // avoids scanning hundreds of pages per deep-book sample.
      const center = entry.page + estimatedOffset
      start = Math.max(1, center - 5)
      end = Math.min(pdf.numPages, center + 5)
    } else {
      // No estimate yet: search a generous window after the TOC end.
      start = Math.max(1, searchAfterPdfPage)
      end = Math.min(pdf.numPages, entry.page + 200)
    }
    let foundAt: number | null = null
    for (let p = start; p <= end; p++) {
      if (await titleAppearsOnPage(pdf, p, core)) {
        foundAt = p
        const off = p - entry.page
        offsets.push(off)
        if (estimatedOffset === null) estimatedOffset = off
        break
      }
    }
    console.log(
      `[outline] offset: sample "${entry.title}" (printed p.${entry.page}) — ` +
        (foundAt
          ? `found on PDF page ${foundAt} → offset ${foundAt - entry.page}`
          : `not found within PDF pages ${start}..${end}`)
    )
  }

  console.log('[outline] offset: collected offsets =', offsets)
  if (offsets.length === 0) return null
  const counts = new Map<number, number>()
  for (const o of offsets) counts.set(o, (counts.get(o) ?? 0) + 1)
  let bestOffset = 0
  let bestCount = 0
  for (const [o, c] of counts) {
    if (c > bestCount) {
      bestCount = c
      bestOffset = o
    }
  }
  console.log(
    `[outline] offset: best candidate = ${bestOffset} with ${bestCount} agreeing samples`
  )
  // Trust the offset when ≥2 samples agree, OR when only 1 sample matched
  // but it looks plausible (non-negative, within typical front-matter range).
  if (bestCount >= 2) return bestOffset
  if (bestCount === 1 && bestOffset >= 0 && bestOffset <= 100) {
    console.log('[outline] offset: only 1 sample matched but value is plausible — using it')
    return bestOffset
  }
  return null
}

// A TOC line that doesn't have a trailing page number but looks like a
// header / section divider. We capture these so things like "Part 1: Colonial
// American History" or "Documents of Colonial American History" appear as
// parents in the outline. They inherit the page of the next entry below them.
const looksLikeHeader = (text: string): boolean => {
  if (text.length < 4 || text.length > 100) return false
  const letterCount = (text.match(/[A-Za-z]/g) ?? []).length
  if (letterCount < 4) return false
  // Must start with a capital letter or roman numeral
  if (!/^[A-Z]/.test(text)) return false
  // Skip things ending in any clausal punctuation — body text
  if (/[.!?,;:]$/.test(text)) return false
  // Skip things that look like a TOC entry that just barely failed parsing
  if (/\s\d{1,4}\s*$/.test(text)) return false
  // Skip lines ending in a roman numeral (e.g. "Course Description viii") —
  // these are TOC entries pointing to front-matter pages we can't yet map.
  // Capturing them as headers would make them inherit the next entry's page,
  // which is wrong, and they pollute offset detection.
  if (/\s[ivxlcdm]+\s*$/i.test(text)) return false
  // Title-case discriminator: at least half of the letter-starting words
  // should be capitalized. Body sentences fail this hard.
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w))
  if (words.length < 1 || words.length > 12) return false
  if (words.length === 1 && words[0].length < 8) return false
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length
  if (capitalized / words.length < 0.5) return false
  return true
}

interface RawTocItem {
  title: string
  page: number | null // null = pageless header, page filled in post-processing
  x: number
  fromPage: number // PDF page where this item was scraped from
}

// Map raw items' x-positions to discrete depth levels (0..4).
// Cluster x values within a 4 PDF-unit tolerance, then sort clusters left→right
// and assign depth = cluster index.
const assignDepthsFromX = (items: RawTocItem[]): number[] => {
  if (items.length === 0) return []
  const TOL = 4
  // Build sorted list of x values; cluster greedily
  const sortedX = [...items.map((i) => i.x)].sort((a, b) => a - b)
  const clusters: number[] = [] // cluster center x's
  for (const x of sortedX) {
    const last = clusters[clusters.length - 1]
    if (last === undefined || x - last > TOL) {
      clusters.push(x)
    }
  }
  // Map an x to its cluster index
  const depthOf = (x: number): number => {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < clusters.length; i++) {
      const d = Math.abs(x - clusters[i])
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    return Math.min(bestIdx, 4)
  }
  return items.map((i) => depthOf(i.x))
}

const extractFromToc = async (pdf: pdfjsLib.PDFDocumentProxy): Promise<ParsedItem[]> => {
  const headerSearchLimit = Math.min(pdf.numPages, 30)
  let tocStart = -1
  let headerLine = ''
  for (let p = 1; p <= headerSearchLimit; p++) {
    const lines = await collectPageLines(pdf, p)
    const hit = lines.find((l) => TOC_HEADER_RE.test(l.text))
    if (hit) {
      tocStart = p
      headerLine = hit.text
      break
    }
  }
  if (tocStart < 0) {
    console.log('[outline] TOC: no "Contents" header found in first', headerSearchLimit, 'pages')
    return []
  }
  console.log('[outline] TOC: header found on PDF page', tocStart, '— line:', JSON.stringify(headerLine))

  const raw: RawTocItem[] = []
  let consecutiveEmpty = 0
  let maxEntriesPerPage = 0
  // TOCs are rarely longer than 20 pages
  const tocEndCap = Math.min(tocStart + 20, pdf.numPages)
  let lastTocPage = tocStart
  for (let p = tocStart; p <= tocEndCap; p++) {
    const lines = await collectPageLines(pdf, p)
    let foundOnPage = 0
    let headersOnPage = 0
    const skipped: string[] = []
    for (const line of lines) {
      const entry = isLikelyTocEntry(line.text)
      if (entry) {
        raw.push({ title: entry.title, page: entry.page, x: line.x, fromPage: p })
        foundOnPage++
      } else if (TOC_HEADER_RE.test(line.text)) {
        // The "Contents" header itself — ignore
      } else if (looksLikeHeader(line.text)) {
        raw.push({ title: line.text, page: null, x: line.x, fromPage: p })
        headersOnPage++
      } else if (line.text.length > 0) {
        skipped.push(line.text)
      }
    }
    console.log(
      `[outline] TOC: PDF page ${p} — matched ${foundOnPage} entries, ${headersOnPage} headers, skipped ${skipped.length} other lines`
    )
    if (skipped.length > 0 && foundOnPage === 0 && headersOnPage === 0) {
      console.log('[outline] TOC: sample skipped lines:', skipped.slice(0, 5))
    }
    // Dynamic threshold: once we've seen pages with many entries, a page
    // with very few entries is almost certainly body-text noise (a stray
    // line that happens to match the regex), not real TOC tail. Tying the
    // threshold to the max we've seen lets us tolerate both dense TOCs
    // (hundreds of entries) and modest ones (a dozen entries).
    const advanceThreshold = maxEntriesPerPage === 0 ? 1 : Math.max(2, Math.floor(maxEntriesPerPage * 0.15))
    if (foundOnPage >= advanceThreshold) {
      consecutiveEmpty = 0
      lastTocPage = p
      if (foundOnPage > maxEntriesPerPage) maxEntriesPerPage = foundOnPage
    } else if (raw.length > 1) {
      consecutiveEmpty++
      if (consecutiveEmpty >= 2) break
    }
  }

  // Drop anything captured past the last entry-bearing page — it's body text
  // that snuck through looksLikeHeader.
  const beforeFilter = raw.length
  const trimmed = raw.filter((r) => r.fromPage <= lastTocPage)
  console.log(
    `[outline] TOC: collected ${beforeFilter} raw items, kept ${trimmed.length} within TOC range (lastTocPage = ${lastTocPage})`
  )

  if (trimmed.length === 0) return []

  // Inherit pages for headers — each pageless header takes the next entry's page.
  // Drop trailing headers with no entry below them.
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i].page === null) {
      for (let j = i + 1; j < trimmed.length; j++) {
        if (trimmed[j].page !== null) {
          trimmed[i].page = trimmed[j].page
          break
        }
      }
    }
  }
  const filled = trimmed.filter((r) => r.page !== null) as Required<RawTocItem>[]

  // Assign depths from X-position clustering
  const depths = assignDepthsFromX(filled)
  const items: ParsedItem[] = filled.map((r, i) => ({
    title: r.title,
    page: r.page!,
    depth: depths[i],
  }))

  console.log('[outline] TOC: depth clusters detected, first 8 items:', items.slice(0, 8))

  // Try the embedded page-labels map first — most reliable when the PDF
  // declares it (common for textbooks with roman-numeral front matter).
  const usedLabels = await mapViaPageLabels(pdf, items)
  if (usedLabels) {
    return items
  }

  // Otherwise, hunt for sample titles on real chapter pages and infer a
  // single offset to apply to every entry.
  const offset = await detectPageOffset(pdf, items, lastTocPage + 1)
  if (offset !== null && offset !== 0) {
    console.log(`[outline] TOC: applying page offset = ${offset}`)
    for (const it of items) it.page = Math.min(pdf.numPages, it.page + offset)
  } else if (offset === 0) {
    console.log('[outline] TOC: detected offset = 0, leaving printed pages as-is')
  } else {
    console.log('[outline] TOC: could NOT confidently detect offset — leaving printed pages as-is')
  }
  return items
}

// PDFs sometimes declare explicit page labels via the /PageLabels dictionary.
// pdf.getPageLabels() returns labels[i] = printed label for PDF page (i+1).
// When useful (i.e. labels differ from sequential PDF indices), we can map
// each TOC entry directly: label === printed page → PDF page index.
const mapViaPageLabels = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  items: ParsedItem[]
): Promise<boolean> => {
  let labels: (string | null)[] | null = null
  try {
    labels = await pdf.getPageLabels()
  } catch {
    labels = null
  }
  if (!labels || labels.length === 0) {
    console.log('[outline] page labels: not declared by PDF')
    return false
  }
  const allSequential = labels.every((l, i) => l === String(i + 1))
  if (allSequential) {
    console.log('[outline] page labels: declared but identical to PDF page indices (no extra info)')
    return false
  }
  console.log('[outline] page labels: detected, first 15 =', labels.slice(0, 15))

  // First-occurrence wins for label collisions (rare but possible across resets)
  const labelToPdf = new Map<string, number>()
  labels.forEach((l, i) => {
    if (l && !labelToPdf.has(l)) labelToPdf.set(l, i + 1)
  })

  let mapped = 0
  let unmapped = 0
  const sampleUnmapped: string[] = []
  for (const it of items) {
    const target = labelToPdf.get(String(it.page))
    if (target !== undefined) {
      it.page = target
      mapped++
    } else {
      unmapped++
      if (sampleUnmapped.length < 3) sampleUnmapped.push(`"${it.title}" (printed p.${it.page})`)
    }
  }
  console.log(
    `[outline] page labels: mapped ${mapped} of ${items.length} entries; unmapped sample: ${sampleUnmapped.join('; ')}`
  )
  // Trust label-based mapping if we got most entries
  return mapped >= items.length * 0.6
}

// ── Heuristic detection (when no embedded outline) ───────────────────────────
//
// We scan each page's text content line-by-line looking for:
//   • "Chapter N" / "Chapter N:" / "Chapter N — Title"
//   • "Part N" / "Section N"
//   • "1.", "1.1", "1.2.3" — numbered hierarchy at start of line
//
// Constraints to avoid pulling in body-text matches:
//   • Match only at the start of a line (line-anchored regex).
//   • Require the heading line to be < 120 chars total (titles are short).
//   • Skip lines that end with "." after long text — those are sentences.

const CHAPTER_RE = /^(chapter|part|section|appendix)\s+([ivxlcdm\d]+)\b\s*[:.\-—]?\s*(.{0,100})?$/i
const NUMBERED_RE = /^(\d+(?:\.\d+){0,3})\.?\s+(.{2,100})$/

const titleCase = (s: string): string =>
  s.replace(/\s+/g, ' ').trim()

interface PageLine {
  text: string
  x: number // leftmost x of the line in PDF user-space units
}

const collectPageLines = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<PageLine[]> => {
  const page = await pdf.getPage(pageNum)
  const tc = await page.getTextContent()
  type Item = { str: string; transform: number[] }
  const items = tc.items.filter(
    (it): it is Item & typeof it => 'str' in it && 'transform' in it
  )
  if (items.length === 0) return []
  // Group items by approximate Y position to reconstruct lines
  const rows = new Map<number, Item[]>()
  for (const it of items) {
    const y = Math.round((it.transform as number[])[5])
    const arr = rows.get(y) ?? []
    arr.push(it)
    rows.set(y, arr)
  }
  // Sort by Y descending (PDF coords go up); within each row, sort by X to
  // preserve reading order, then join.
  return Array.from(rows.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => {
      row.sort((a, b) => a.transform[4] - b.transform[4])
      const text = row.map((i) => i.str).join('').replace(/\s+/g, ' ').trim()
      const x = row[0]?.transform[4] ?? 0
      return { text, x }
    })
    .filter((l) => l.text.length > 0)
}

const detectHeuristic = async (pdf: pdfjsLib.PDFDocumentProxy): Promise<ParsedItem[]> => {
  const out: ParsedItem[] = []
  const seen = new Set<string>()
  const total = pdf.numPages
  // Scan up to 600 pages — plenty for any practical document, bounded for huge PDFs.
  const limit = Math.min(total, 600)
  for (let p = 1; p <= limit; p++) {
    const lines = await collectPageLines(pdf, p)
    for (const { text: line } of lines) {
      if (line.length > 120) continue
      // Skip lines that are clearly body text (end with a period after a long sentence)
      if (line.length > 60 && /[a-z][.!?]\s*$/.test(line)) continue

      let match = line.match(CHAPTER_RE)
      if (match) {
        const kind = match[1]
        const num = match[2]
        const tail = (match[3] ?? '').trim()
        const title = titleCase(tail ? `${kind} ${num}: ${tail}` : `${kind} ${num}`)
        const key = title.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ title, page: p, depth: 0 })
        }
        continue
      }

      match = line.match(NUMBERED_RE)
      if (match) {
        const numbering = match[1]
        const title = titleCase(`${numbering} ${match[2]}`)
        const depth = Math.min(numbering.split('.').length - 1, 4)
        const key = title.toLowerCase()
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ title, page: p, depth })
        }
      }
    }
  }
  return out
}

// ── Public entry: parse outline for a source ────────────────────────────────

export const extractOutline = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  sourceId: string
): Promise<OutlineItem[]> => {
  console.log('[outline] extractOutline: starting for', sourceId, '— total pages:', pdf.numPages)
  let items = await extractEmbedded(pdf)
  let origin: OutlineItem['origin'] = 'embedded'
  console.log(`[outline] embedded outline (pdf.getOutline): ${items.length} items`)
  if (items.length === 0) {
    items = await extractFromToc(pdf)
    if (items.length > 0) origin = 'toc'
  }
  if (items.length === 0) {
    console.log('[outline] falling back to body-text heuristic')
    items = await detectHeuristic(pdf)
    origin = 'heuristic'
  }
  console.log(`[outline] final: origin=${origin}, ${items.length} items`)
  if (items.length > 0) {
    console.log('[outline] first 8 final items:', items.slice(0, 8))
  }
  if (items.length === 0) return []

  // Convert to OutlineItem[], assigning parent_ids by walking the depth stack.
  const result: OutlineItem[] = []
  const stack: { id: string; depth: number }[] = []
  items.forEach((p, i) => {
    while (stack.length > 0 && stack[stack.length - 1].depth >= p.depth) stack.pop()
    const id = uuidv4()
    const parent_id = stack.length > 0 ? stack[stack.length - 1].id : null
    result.push({
      id,
      source_id: sourceId,
      parent_id,
      title: p.title,
      page_number: p.page,
      sort_order: i,
      depth: p.depth,
      origin,
    })
    stack.push({ id, depth: p.depth })
  })
  return result
}

// Find the outline item that "owns" a given page — the latest item whose
// page_number is <= the target page (in sort order).
export const findOutlineItemForPage = (
  items: OutlineItem[],
  page: number
): OutlineItem | null => {
  let best: OutlineItem | null = null
  for (const it of items) {
    if (it.page_number <= page) {
      if (!best || it.sort_order > best.sort_order) best = it
    }
  }
  return best
}
