import { useState, useEffect } from 'react'
import { FileText, X } from 'lucide-react'
import TagInput from './TagInput'
import { titleFromFilePath } from '../lib/title'

interface Props {
  filePath: string
  allTags: string[]
  onConfirm: (title: string, tags: string[]) => void | Promise<void>
  onCancel: () => void
}

const deriveType = (filePath: string): string =>
  filePath.split('.').pop()?.toLowerCase() ?? ''

export default function ImportModal({ filePath, allTags, onConfirm, onCancel }: Props) {
  const [title, setTitle] = useState(titleFromFilePath(filePath))
  const [tags, setTags] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const type = deriveType(filePath)

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleSubmit = async () => {
    if (submitting) return
    const finalTitle = title.trim() || titleFromFilePath(filePath)
    setSubmitting(true)
    try {
      await onConfirm(finalTitle, tags)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] max-w-[90vw] bg-ink border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="font-serif text-lg text-blush">Import document</h2>
          <button
            onClick={onCancel}
            className="p-1 text-lavender/40 hover:text-blush transition-colors rounded"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2.5">
            <div className="w-9 h-12 bg-ocean/20 rounded flex items-center justify-center shrink-0">
              <FileText size={16} className="text-ocean" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-lavender/40 uppercase tracking-wider">{type}</div>
              <div className="text-sm text-lavender/80 truncate" title={filePath}>
                {filePath}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs text-lavender/60 mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-blush outline-none focus:border-ocean/50"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-lavender/60 mb-1.5">
              Tags <span className="text-lavender/30">— Enter to add, Tab to complete</span>
            </label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={allTags}
              placeholder="e.g. history, ml, reference"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/5">
          <button
            onClick={onCancel}
            className="text-xs text-lavender/60 hover:text-blush px-3 py-1.5 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-ocean text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-ocean/80 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
