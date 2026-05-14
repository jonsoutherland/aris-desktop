import { useState } from 'react'
import { Plus, Trash2, Check, X, Edit2 } from 'lucide-react'
import { useStore } from '../store'

const PRESET_COLORS = [
  '#2978a0', '#7fbeab', '#aea3b0', '#e3d0d8',
  '#f59e0b', '#ef4444', '#8b5cf6', '#10b981',
  '#f97316', '#ec4899', '#06b6d4', '#84cc16',
]

export default function Settings() {
  const { highlightTypes, addHighlightType, updateHighlightType, deleteHighlightType } = useStore()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#2978a0')
  const [newDesc, setNewDesc] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [showColorPicker, setShowColorPicker] = useState<'new' | string | null>(null)

  const handleAdd = async () => {
    if (!newName.trim()) return
    await addHighlightType(newName.trim(), newColor, newDesc.trim() || undefined)
    setNewName('')
    setNewDesc('')
    setNewColor('#2978a0')
  }

  const startEdit = (id: string) => {
    const type = highlightTypes.find((t) => t.id === id)
    if (!type) return
    setEditingId(id)
    setEditName(type.name)
    setEditColor(type.color)
    setEditDesc(type.description ?? '')
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return
    await updateHighlightType(editingId, editName.trim(), editColor, editDesc.trim() || undefined)
    setEditingId(null)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-xl space-y-8">
          <section>
            <h2 className="font-serif text-lg text-blush mb-1">Highlight Types</h2>
            <p className="text-xs text-lavender/50 mb-5">
              Associate colors with tags to categorize your highlights as you read.
            </p>

            <div className="space-y-2 mb-5">
              {highlightTypes.map((type) => (
                <div
                  key={type.id}
                  className="group flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 hover:border-ocean/20 transition-all"
                >
                  {editingId === type.id ? (
                    <div className="flex-1 flex items-center gap-2">
                      <div className="relative">
                        <button
                          onClick={() =>
                            setShowColorPicker(showColorPicker === type.id ? null : type.id)
                          }
                          className="w-7 h-7 rounded-full border-2 border-white/20 hover:border-white/40 transition-colors shrink-0"
                          style={{ backgroundColor: editColor }}
                        />
                        {showColorPicker === type.id && (
                          <div className="absolute top-9 left-0 z-50 bg-ink border border-white/10 rounded-xl p-3 shadow-2xl grid grid-cols-6 gap-1.5 w-44">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c}
                                onClick={() => {
                                  setEditColor(c)
                                  setShowColorPicker(null)
                                }}
                                className="w-6 h-6 rounded-full hover:scale-110 transition-transform"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                            <input
                              type="color"
                              value={editColor}
                              onChange={(e) => setEditColor(e.target.value)}
                              className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent col-span-2"
                              title="Custom color"
                            />
                          </div>
                        )}
                      </div>

                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-blush outline-none focus:border-ocean/50"
                        placeholder="Name"
                      />
                      <input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-sm text-lavender/60 outline-none focus:border-ocean/50"
                        placeholder="Description (optional)"
                      />
                      <button onClick={saveEdit} className="text-ocean hover:text-ocean/70 transition-colors">
                        <Check size={15} />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-lavender/40 hover:text-lavender transition-colors"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className="w-5 h-5 rounded-full shrink-0"
                        style={{ backgroundColor: type.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-blush font-medium">{type.name}</p>
                        {type.description && (
                          <p className="text-xs text-lavender/50 truncate">{type.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(type.id)}
                          className="p-1.5 text-lavender/30 hover:text-ocean transition-colors rounded-lg hover:bg-ocean/10"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => deleteHighlightType(type.id)}
                          className="p-1.5 text-lavender/30 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Add new */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <p className="text-xs text-lavender/50 mb-3">Add new highlight type</p>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowColorPicker(showColorPicker === 'new' ? null : 'new')}
                    className="w-8 h-8 rounded-full border-2 border-white/20 hover:border-white/40 transition-colors shrink-0"
                    style={{ backgroundColor: newColor }}
                  />
                  {showColorPicker === 'new' && (
                    <div className="absolute top-10 left-0 z-50 bg-ink border border-white/10 rounded-xl p-3 shadow-2xl grid grid-cols-6 gap-1.5 w-44">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => {
                            setNewColor(c)
                            setShowColorPicker(null)
                          }}
                          className="w-6 h-6 rounded-full hover:scale-110 transition-transform"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent col-span-2"
                        title="Custom color"
                      />
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Name (e.g. Main Ideas)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-blush outline-none focus:border-ocean/50"
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-lavender/60 outline-none focus:border-ocean/50"
                />
                <button
                  onClick={handleAdd}
                  disabled={!newName.trim()}
                  className="flex items-center gap-1.5 bg-ocean text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ocean/80 transition-colors disabled:opacity-40"
                >
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
