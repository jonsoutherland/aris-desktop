import { useState, useEffect, useMemo } from 'react'
import { Copy, Check, Quote, ChevronDown, ChevronUp, BookOpen, Pencil } from 'lucide-react'
import { useStore } from '../store'
import { clsx } from 'clsx'
import { formatCitation, CITATION_STYLES, type CitationStyle } from '../lib/citations'
import type { Highlight, KnowledgeSource } from '../types'

type SortOrder = 'page' | 'date'

const STYLE_KEY = 'aris:citation-style'

interface HighlightRow extends Omit<Highlight, 'rects'> {
  rects: string
}

interface MetadataFormState {
  author: string
  publication_year: string
  publisher: string
  edition: string
}

function MetadataForm({
  source,
  onSave,
  onCancel,
}: {
  source: KnowledgeSource
  onSave: (data: MetadataFormState) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<MetadataFormState>({
    author: source.author ?? '',
    publication_year: source.publication_year?.toString() ?? '',
    publisher: source.publisher ?? '',
    edition: source.edition ?? '',
  })

  const field = (
    key: keyof MetadataFormState,
    placeholder: string,
    label: string,
    type = 'text'
  ) => (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-lavender/50 uppercase tracking-widest">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-blush placeholder-lavender/30 outline-none focus:border-ocean/50 transition-colors"
      />
    </div>
  )

  return (
    <div className="mt-3 p-4 bg-white/3 border border-white/8 rounded-xl space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {field('author', 'e.g. Melville, Herman', 'Author')}
        {field('publication_year', 'e.g. 1851', 'Year', 'number')}
        {field('publisher', 'e.g. Harper & Brothers', 'Publisher')}
        {field('edition', 'e.g. 2nd', 'Edition (optional)')}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave(form)}
          className="px-4 py-1.5 bg-ocean/20 text-ocean text-xs font-medium rounded-lg hover:bg-ocean/30 transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-lavender/40 text-xs rounded-lg hover:text-lavender transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function CitationCard({
  highlight,
  source,
  style,
}: {
  highlight: Highlight
  source: KnowledgeSource
  style: CitationStyle
}) {
  const [copied, setCopied] = useState(false)
  const citation = formatCitation(source, highlight.page_number, style)
  const full = `"${highlight.selected_text}" — ${citation}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(full)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="group bg-white/5 border border-white/8 rounded-xl p-4 hover:border-ocean/20 transition-all">
      <div className="flex gap-3">
        <Quote size={14} className="text-ocean/40 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-blush/80 text-sm leading-relaxed italic">
            {highlight.selected_text}
          </p>
          <p className="text-lavender/50 text-xs mt-2 font-mono leading-relaxed">{citation}</p>
          <p className="text-lavender/30 text-[10px] mt-1">p. {highlight.page_number}</p>
        </div>
        <button
          onClick={handleCopy}
          title="Copy citation"
          className={clsx(
            'shrink-0 p-1.5 rounded-lg transition-all',
            copied
              ? 'text-sage bg-sage/10'
              : 'text-lavender/30 hover:text-ocean opacity-0 group-hover:opacity-100 hover:bg-ocean/10'
          )}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  )
}

export default function Citations() {
  const { sources, updateSourceMetadata } = useStore()
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [style, setStyle] = useState<CitationStyle>(
    () => (localStorage.getItem(STYLE_KEY) as CitationStyle | null) ?? 'APA'
  )
  const [sort, setSort] = useState<SortOrder>('page')
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [collapsedSources, setCollapsedSources] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.db
      .all<HighlightRow>('SELECT * FROM highlights ORDER BY created_at')
      .then((rows) =>
        setHighlights(
          rows.map((r) => ({ ...r, rects: JSON.parse(r.rects as unknown as string) }))
        )
      )
  }, [])

  const setStyleAndPersist = (s: CitationStyle) => {
    setStyle(s)
    localStorage.setItem(STYLE_KEY, s)
  }

  const handleSaveMetadata = async (sourceId: string, form: MetadataFormState) => {
    await updateSourceMetadata(sourceId, {
      author: form.author || undefined,
      publication_year: form.publication_year ? parseInt(form.publication_year, 10) : null,
      publisher: form.publisher || undefined,
      edition: form.edition || undefined,
    })
    setEditingSourceId(null)
  }

  const toggleCollapse = (id: string) =>
    setCollapsedSources((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const sourcesWithHighlights = useMemo(() => {
    const grouped = new Map<string, Highlight[]>()
    for (const h of highlights) {
      const list = grouped.get(h.source_id) ?? []
      list.push(h)
      grouped.set(h.source_id, list)
    }

    return Array.from(grouped.entries())
      .map(([sourceId, hl]) => ({
        source: sources.find((s) => s.id === sourceId),
        highlights: hl,
      }))
      .filter((g): g is { source: KnowledgeSource; highlights: Highlight[] } => !!g.source)
  }, [highlights, sources])

  const sortedHighlights = (hl: Highlight[]) =>
    [...hl].sort((a, b) =>
      sort === 'page' ? a.page_number - b.page_number : a.created_at - b.created_at
    )

  const totalHighlights = highlights.length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush mb-4">Citations</h1>

        <div className="flex items-center gap-3">
          {/* Citation style */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
            {CITATION_STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setStyleAndPersist(s)}
                className={clsx(
                  'px-3 py-1 rounded-md text-xs font-medium transition-all',
                  style === s
                    ? 'bg-ocean/20 text-ocean'
                    : 'text-lavender/50 hover:text-blush'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Sort order */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
            <button
              onClick={() => setSort('page')}
              className={clsx(
                'px-3 py-1 rounded-md text-xs font-medium transition-all',
                sort === 'page' ? 'bg-ocean/20 text-ocean' : 'text-lavender/50 hover:text-blush'
              )}
            >
              By Page
            </button>
            <button
              onClick={() => setSort('date')}
              className={clsx(
                'px-3 py-1 rounded-md text-xs font-medium transition-all',
                sort === 'date' ? 'bg-ocean/20 text-ocean' : 'text-lavender/50 hover:text-blush'
              )}
            >
              By Date
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-8">
        {sourcesWithHighlights.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-lavender/40">
            <BookOpen size={48} strokeWidth={1} />
            <p className="text-sm">No highlights yet. Highlight text while reading to generate citations.</p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-10">
            {sourcesWithHighlights.map(({ source, highlights: hl }) => {
              const isCollapsed = collapsedSources.has(source.id)
              const isEditing = editingSourceId === source.id
              const hasMetadata = !!(source.author || source.publication_year || source.publisher)
              const sorted = sortedHighlights(hl)

              return (
                <div key={source.id}>
                  {/* Source header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <button
                        onClick={() => toggleCollapse(source.id)}
                        className="flex items-center gap-2 text-left group"
                      >
                        <h2 className="font-serif text-base text-blush group-hover:text-ocean transition-colors truncate">
                          {source.title}
                        </h2>
                        {isCollapsed ? (
                          <ChevronDown size={14} className="text-lavender/40 shrink-0" />
                        ) : (
                          <ChevronUp size={14} className="text-lavender/40 shrink-0" />
                        )}
                      </button>
                      {hasMetadata && !isEditing && (
                        <p className="text-xs text-lavender/40 mt-0.5">
                          {[source.author, source.publication_year, source.publisher]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() =>
                        setEditingSourceId(isEditing ? null : source.id)
                      }
                      className={clsx(
                        'shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all',
                        isEditing
                          ? 'text-ocean bg-ocean/10'
                          : hasMetadata
                          ? 'text-lavender/40 hover:text-ocean hover:bg-ocean/10'
                          : 'text-sage bg-sage/10 hover:bg-sage/20 animate-pulse'
                      )}
                    >
                      <Pencil size={11} />
                      {hasMetadata ? 'Edit info' : 'Add book info'}
                    </button>
                  </div>

                  {/* Metadata form */}
                  {isEditing && (
                    <MetadataForm
                      source={source}
                      onSave={(form) => handleSaveMetadata(source.id, form)}
                      onCancel={() => setEditingSourceId(null)}
                    />
                  )}

                  {/* Citations list */}
                  {!isCollapsed && (
                    <div className="space-y-2 mt-3">
                      {sorted.map((h) => (
                        <CitationCard
                          key={h.id}
                          highlight={h}
                          source={source}
                          style={style}
                        />
                      ))}
                    </div>
                  )}

                  {isCollapsed && (
                    <p className="text-xs text-lavender/30 mt-1">
                      {hl.length} highlight{hl.length !== 1 ? 's' : ''} — click to expand
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="px-8 py-3 border-t border-white/5 flex items-center gap-6 text-xs text-lavender/40">
        <span>{totalHighlights} highlight{totalHighlights !== 1 ? 's' : ''}</span>
        <span>{sourcesWithHighlights.length} source{sourcesWithHighlights.length !== 1 ? 's' : ''}</span>
        <span>{style} format</span>
      </div>
    </div>
  )
}
