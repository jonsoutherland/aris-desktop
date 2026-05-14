import { useState, useEffect } from 'react'
import { Plus, BookOpen, Trash2, Tag, ImagePlus } from 'lucide-react'
import { useStore } from '../store'
import type { KnowledgeSource } from '../types'
import ImportModal from './ImportModal'
import TagInput from './TagInput'
import CoverPickerModal from './CoverPickerModal'

export default function Library() {
  const {
    sources,
    loadSources,
    addSource,
    deleteSource,
    setActiveSource,
    setView,
    getSourceTags,
    getAllTags,
    addSourceTag,
    removeSourceTag,
    saveCoverImage,
  } = useStore()
  const [sourceTags, setSourceTags] = useState<Record<string, string[]>>({})
  const [allTags, setAllTags] = useState<string[]>([])
  const [expandedTags, setExpandedTags] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<string | null>(null)
  const [coverPicker, setCoverPicker] = useState<{ source: KnowledgeSource; openAfter: boolean } | null>(null)

  useEffect(() => {
    loadSources()
    getAllTags().then(setAllTags)
  }, [])

  useEffect(() => {
    const loadTags = async () => {
      const tagsMap: Record<string, string[]> = {}
      for (const source of sources) {
        tagsMap[source.id] = await getSourceTags(source.id)
      }
      setSourceTags(tagsMap)
    }
    if (sources.length > 0) loadTags()
  }, [sources])

  const refreshAllTags = async () => {
    setAllTags(await getAllTags())
  }

  const handleImport = async () => {
    const filePath = await window.api.openFile()
    if (!filePath) return
    setPendingImport(filePath)
  }

  const finalizeImport = async (title: string, tags: string[]) => {
    if (!pendingImport) return
    const source = await addSource(pendingImport, title)
    if (!source) { setPendingImport(null); return }
    for (const t of tags) await addSourceTag(source.id, t)
    setSourceTags((prev) => ({ ...prev, [source.id]: tags }))
    await refreshAllTags()
    setPendingImport(null)
    setCoverPicker({ source, openAfter: true })
  }

  const openSource = (source: KnowledgeSource) => {
    setActiveSource(source.id)
    setView('reader')
  }

  const handleTagsChange = async (sourceId: string, next: string[]) => {
    const prev = sourceTags[sourceId] ?? []
    const added = next.filter((t) => !prev.includes(t))
    const removed = prev.filter((t) => !next.includes(t))
    for (const t of added) await addSourceTag(sourceId, t)
    for (const t of removed) await removeSourceTag(sourceId, t)
    setSourceTags((p) => ({ ...p, [sourceId]: next }))
    if (added.length > 0) await refreshAllTags()
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush">Knowledge Library</h1>
        <button
          onClick={handleImport}
          className="flex items-center gap-2 bg-ocean text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ocean/80 transition-colors"
        >
          <Plus size={15} />
          Import Document
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {sources.filter((s) => s.type !== 'vocab').length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-lavender/40">
            <BookOpen size={48} strokeWidth={1} />
            <p className="text-sm">No documents yet. Import a PDF to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 max-w-3xl">
            {sources.filter((s) => s.type !== 'vocab').map((source) => (
              <div
                key={source.id}
                className="group bg-white/5 border border-white/10 rounded-xl p-4 hover:border-ocean/40 transition-all"
              >
                <div className="flex items-start gap-4">
                  {/* Thumbnail — click to pick or change cover */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverPicker({ source, openAfter: false }) }}
                    className="w-10 h-14 rounded-lg overflow-hidden shrink-0 mt-0.5 relative group/thumb bg-ocean/20 focus:outline-none"
                    title={source.cover_image ? 'Change cover' : 'Set cover'}
                  >
                    {source.cover_image ? (
                      <img src={source.cover_image} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <BookOpen size={18} className="text-ocean" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/55 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center">
                      <ImagePlus size={13} className="text-white" />
                    </div>
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => openSource(source)}
                      className="text-left hover:text-ocean transition-colors"
                    >
                      <h3 className="font-serif text-blush font-bold text-base truncate">{source.title}</h3>
                    </button>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-lavender/50 uppercase tracking-wider">
                        {source.type}
                      </span>
                      {source.total_pages && (
                        <span className="text-xs text-lavender/40">{source.total_pages} pages</span>
                      )}
                      {source.last_opened && (
                        <span className="text-xs text-lavender/30">
                          Last opened {new Date(source.last_opened).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    {/* Tags */}
                    {expandedTags === source.id ? (
                      <div className="mt-2">
                        <TagInput
                          value={sourceTags[source.id] ?? []}
                          onChange={(next) => handleTagsChange(source.id, next)}
                          suggestions={allTags}
                          autoFocus
                        />
                        <button
                          onClick={() => setExpandedTags(null)}
                          className="mt-1 text-[11px] text-lavender/40 hover:text-lavender transition-colors"
                        >
                          done
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {(sourceTags[source.id] ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="bg-sage/10 text-sage text-[11px] px-2 py-0.5 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                        <button
                          onClick={() => setExpandedTags(source.id)}
                          className="flex items-center gap-1 text-lavender/30 hover:text-lavender text-[11px] transition-colors"
                        >
                          <Tag size={10} />
                          <span>{(sourceTags[source.id] ?? []).length === 0 ? 'tag' : 'edit'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openSource(source)}
                      className="flex items-center gap-1.5 bg-ocean/20 text-ocean px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-ocean/30 transition-colors"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => deleteSource(source.id)}
                      className="p-1.5 text-lavender/30 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingImport && (
        <ImportModal
          filePath={pendingImport}
          allTags={allTags}
          onConfirm={finalizeImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {coverPicker && (
        <CoverPickerModal
          source={coverPicker.source}
          onSelect={async (dataUrl) => {
            await saveCoverImage(coverPicker.source.id, dataUrl)
            const { openAfter, source } = coverPicker
            setCoverPicker(null)
            if (openAfter) openSource(source)
          }}
          onSkip={() => {
            const { openAfter, source } = coverPicker
            setCoverPicker(null)
            if (openAfter) openSource(source)
          }}
        />
      )}
    </div>
  )
}
