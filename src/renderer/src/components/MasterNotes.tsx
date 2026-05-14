import { useState, useMemo } from 'react'
import { Search, BookOpen, Trash2, Edit2, Check, X } from 'lucide-react'
import { useStore } from '../store'
import { clsx } from 'clsx'

export default function MasterNotes() {
  const { notes, sources, activeSourceId, deleteNote, updateNote, setView, setActiveSource } = useStore()
  const [search, setSearch] = useState('')
  const [filterSourceId, setFilterSourceId] = useState<string | 'all'>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTerm, setEditTerm] = useState('')
  const [editDef, setEditDef] = useState('')

  const displayed = useMemo(() => {
    let list = notes
    if (filterSourceId !== 'all') list = list.filter((n) => n.source_id === filterSourceId)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (n) => n.term.toLowerCase().includes(q) || n.definition.toLowerCase().includes(q)
      )
    }
    return list
  }, [notes, filterSourceId, search])

  // Group by source + outline section (chapter), falling back to page when no
  // section is known. Notes save their section title into `chapter` at creation.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof displayed>()
    for (const note of displayed) {
      const source = sources.find((s) => s.id === note.source_id)
      const section = note.chapter ?? `p. ${note.page_number ?? '?'}`
      const key = `${source?.title ?? 'Unknown'} — ${section}`
      const existing = map.get(key) ?? []
      existing.push(note)
      map.set(key, existing)
    }
    return map
  }, [displayed, sources])

  const startEdit = (id: string, term: string, definition: string) => {
    setEditingId(id)
    setEditTerm(term)
    setEditDef(definition)
  }

  const saveEdit = async (id: string) => {
    await updateNote(id, editTerm, editDef)
    setEditingId(null)
  }

  const openInReader = (sourceId: string) => {
    setActiveSource(sourceId)
    setView('reader')
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush mb-4">Master Notes</h1>

        <div className="flex gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-lavender/40" />
            <input
              type="text"
              placeholder="Search notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-blush outline-none focus:border-ocean/50"
            />
          </div>

          <select
            value={filterSourceId}
            onChange={(e) => setFilterSourceId(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-lavender/70 outline-none focus:border-ocean/50"
          >
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-lavender/40">
            <BookOpen size={48} strokeWidth={1} />
            <p className="text-sm">No notes yet. Start reading and take notes to see them here.</p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-8">
            {Array.from(grouped.entries()).map(([group, groupNotes]) => (
              <div key={group}>
                <h2 className="font-serif text-sm text-lavender/50 mb-3 flex items-center gap-2">
                  <span className="flex-1">{group}</span>
                  <button
                    onClick={() => {
                      const note = groupNotes[0]
                      if (note) openInReader(note.source_id)
                    }}
                    className="text-ocean/60 hover:text-ocean text-xs transition-colors"
                  >
                    Open
                  </button>
                </h2>

                <div className="space-y-2">
                  {groupNotes.map((note) => (
                    <div
                      key={note.id}
                      className="group bg-white/5 border border-white/10 rounded-xl p-4 hover:border-ocean/20 transition-all"
                    >
                      {editingId === note.id ? (
                        <div className="space-y-2">
                          <input
                            value={editTerm}
                            onChange={(e) => setEditTerm(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-sage font-medium outline-none focus:border-ocean/50"
                          />
                          <textarea
                            value={editDef}
                            onChange={(e) => setEditDef(e.target.value)}
                            rows={3}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-blush/80 outline-none focus:border-ocean/50 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(note.id)}
                              className="flex items-center gap-1.5 text-xs text-ocean hover:text-ocean/70 transition-colors"
                            >
                              <Check size={12} />
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex items-center gap-1.5 text-xs text-lavender/40 hover:text-lavender transition-colors"
                            >
                              <X size={12} />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-4">
                          <div className="flex-1 min-w-0">
                            <p className="text-sage font-medium text-sm">{note.term}</p>
                            <p className="text-blush/70 text-sm mt-1 leading-relaxed">{note.definition}</p>
                          </div>
                          <div className="flex items-start gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => startEdit(note.id, note.term, note.definition)}
                              className="p-1.5 text-lavender/30 hover:text-ocean transition-colors rounded-lg hover:bg-ocean/10"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              onClick={() => deleteNote(note.id)}
                              className="p-1.5 text-lavender/30 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="px-8 py-3 border-t border-white/5 flex items-center gap-6 text-xs text-lavender/40">
        <span>{notes.length} total notes</span>
        {search && <span>{displayed.length} matching</span>}
      </div>
    </div>
  )
}
