import { useState, useMemo, useRef, useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
  autoFocus?: boolean
}

// Tag input with chips + autocomplete dropdown.
// - Type to filter prior tags. Down/Up navigate the dropdown, Tab completes the
//   highlighted suggestion into the input, Enter adds it as a tag (or adds the
//   raw text if nothing is highlighted).
// - Backspace on an empty input removes the last chip.
export default function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = 'Add tag…',
  autoFocus,
}: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    const used = new Set(value.map((t) => t.toLowerCase()))
    const pool = suggestions.filter((s) => !used.has(s.toLowerCase()))
    if (!q) return pool.slice(0, 8)
    return pool.filter((s) => s.toLowerCase().includes(q)).slice(0, 8)
  }, [text, suggestions, value])

  // Reset highlight when filtered list changes
  useEffect(() => {
    setActiveIdx(0)
  }, [text])

  // Click-outside closes dropdown
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (!tag) return
    if (value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      setText('')
      return
    }
    onChange([...value, tag])
    setText('')
    setActiveIdx(0)
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered.length > 0) {
        addTag(filtered[activeIdx] ?? filtered[0])
      } else {
        addTag(text)
      }
    } else if (e.key === 'Tab') {
      // Tab completes the highlighted suggestion into the input (does not yet add it)
      if (open && filtered.length > 0) {
        e.preventDefault()
        setText(filtered[activeIdx] ?? filtered[0])
      }
    } else if (e.key === 'ArrowDown') {
      if (filtered.length > 0) {
        e.preventDefault()
        setOpen(true)
        setActiveIdx((i) => (i + 1) % filtered.length)
      }
    } else if (e.key === 'ArrowUp') {
      if (filtered.length > 0) {
        e.preventDefault()
        setOpen(true)
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 min-h-[36px] focus-within:border-ocean/50 cursor-text"
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 bg-sage/20 text-sage text-xs px-2 py-0.5 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className="hover:text-blush transition-colors"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          autoFocus={autoFocus}
          className="flex-1 min-w-[100px] bg-transparent outline-none text-sm text-blush placeholder:text-lavender/30"
        />
      </div>

      {open && filtered.length > 0 && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-ink border border-white/10 rounded-lg shadow-xl z-20 max-h-56 overflow-y-auto py-1">
          {filtered.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  addTag(s)
                  inputRef.current?.focus()
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                  i === activeIdx ? 'bg-ocean/20 text-blush' : 'text-lavender/70 hover:bg-white/5'
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
