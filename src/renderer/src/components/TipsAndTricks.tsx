import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

type Tip = { action: string; description: string }
type TipSection = { title: string; tips: Tip[] }

const TIP_SECTIONS: TipSection[] = [
  {
    title: 'Reader — Navigation',
    tips: [
      { action: '→ / ↓ / Space', description: 'Next page' },
      { action: '← / ↑ / Shift+Space', description: 'Previous page' },
      { action: 'Home', description: 'Jump to first page' },
      { action: 'End', description: 'Jump to last page' },
      { action: 'Click page number field', description: 'Type a page number to jump directly to it' },
      { action: 'Ctrl + Scroll', description: 'Zoom in / out' },
      { action: 'Ctrl + =', description: 'Zoom in' },
      { action: 'Ctrl + −', description: 'Zoom out' },
      { action: 'Ctrl + 0', description: 'Reset zoom to default' },
    ],
  },
  {
    title: 'Reader — Highlights',
    tips: [
      { action: 'Click & drag over text', description: 'Create a highlight using the active highlight type' },
      { action: 'Click color indicator in toolbar', description: 'Switch the active highlight type' },
      { action: 'Click a highlight', description: 'Open menu: create note, look up definition, or delete' },
      { action: 'Ctrl + Z', description: 'Undo the last highlight or deletion' },
    ],
  },
  {
    title: 'Reader — Notes (Two-Step Flow)',
    tips: [
      { action: 'Double-click a word', description: 'Start a note — the word becomes the term' },
      { action: 'Click & drag (after double-click)', description: 'Select definition text to complete the note' },
      { action: 'Escape', description: 'Cancel the note-taking flow at any point' },
      { action: 'Click a highlight → "Create note"', description: 'Create a note from an existing highlight' },
      { action: 'Notes button in toolbar', description: 'Toggle the notes sidebar to see all notes for this document' },
      { action: 'Click a note in sidebar', description: "Jump to that note's page in the reader" },
    ],
  },
  {
    title: 'Reader — Dictionary',
    tips: [
      { action: 'Hover over a word for ~3 s', description: 'Opens the dictionary popup automatically' },
      { action: 'Hold Ctrl + hover', description: 'Opens the dictionary immediately, no delay' },
      { action: 'Click + in dictionary popup', description: 'Save the word to your vocabulary list' },
    ],
  },
  {
    title: 'Reader — Outline',
    tips: [
      { action: 'ListTree icon in toolbar', description: 'Toggle the table of contents sidebar' },
      { action: 'Click an outline item', description: 'Jump to that section' },
      { action: 'Refresh icon in outline sidebar', description: 'Re-extract the outline from the PDF' },
    ],
  },
  {
    title: 'Library',
    tips: [
      { action: 'Click "Import Document"', description: 'Import a PDF or EPUB — set title, tags, and cover during import' },
      { action: 'Click a document title', description: 'Open it in the reader (resumes from your last position)' },
      { action: 'Hover a document → "Open"', description: 'Open the document in the reader' },
      { action: 'Hover a document → tag icon', description: 'Edit tags for that document' },
      { action: 'Hover a document → trash icon', description: 'Permanently delete the document' },
      { action: 'Click the cover thumbnail', description: 'Set or change the cover image' },
    ],
  },
  {
    title: 'Notes',
    tips: [
      { action: 'Type in the search box', description: 'Filter notes by term or definition in real time' },
      { action: 'Source dropdown', description: 'Filter notes by a specific document' },
      { action: 'Hover a note → edit icon', description: 'Inline-edit the term and definition' },
      { action: 'Hover a note → trash icon', description: 'Delete the note' },
    ],
  },
  {
    title: 'Flashcards',
    tips: [
      { action: 'Click "Start Review Session"', description: 'Review only cards due today' },
      { action: 'Click "Practice All"', description: 'Review all cards regardless of schedule' },
      { action: 'Click the card', description: 'Flip to reveal the definition' },
      { action: 'Click ✓', description: 'Mark the card correct (advances spaced-repetition interval)' },
      { action: 'Click ✗', description: 'Mark the card incorrect (resets to the shortest interval)' },
      { action: '"End session" button', description: 'Exit the session early' },
    ],
  },
  {
    title: 'Knowledge Graph',
    tips: [
      { action: 'Click & drag background', description: 'Pan the canvas' },
      { action: 'Ctrl + Scroll', description: 'Zoom in / out' },
      { action: 'Drag a node', description: 'Reposition it (node positions are saved)' },
      { action: 'Drag from one node to another', description: 'Create a connection between notes' },
      { action: 'Click a node', description: 'Select it and show its context menu' },
      { action: 'Right-click a node', description: 'Delete the node' },
      { action: 'Ctrl + Z / Ctrl + Y', description: 'Undo / redo connection changes' },
      { action: 'Lock toggle', description: 'Prevent nodes from being accidentally moved' },
    ],
  },
  {
    title: 'Focus Mode (Lock In)',
    tips: [
      { action: 'Select duration + click Start', description: 'Enter a distraction-free full-screen session' },
      { action: 'Alt+Tab during session', description: 'Triggers a cooldown penalty that doubles with each interruption' },
      { action: 'Hold the cancel button for 3 s', description: 'Force-exit an active session early' },
    ],
  },
  {
    title: 'Citations',
    tips: [
      { action: 'Style dropdown', description: 'Switch between APA, MLA, Chicago, and Harvard' },
      { action: 'Click copy on a citation', description: 'Copy the formatted citation to clipboard' },
      { action: 'Edit document metadata', description: 'Set author, year, publisher, and edition for accurate citations' },
    ],
  },
  {
    title: 'Settings',
    tips: [
      { action: 'Click color swatch when adding', description: 'Choose a preset or custom hex color for a highlight type' },
      { action: 'Press Enter in name field', description: 'Quickly add a new highlight type' },
      { action: 'Hover a type → edit icon', description: 'Edit the name, description, or color inline' },
      { action: 'Hover a type → trash icon', description: 'Delete the highlight type' },
    ],
  },
]

function TipRow({ tip }: { tip: Tip }) {
  return (
    <div className="flex items-start gap-4 px-4 py-2.5 odd:bg-white/[0.02]">
      <span className="shrink-0 font-mono text-[11px] text-ocean bg-ocean/10 rounded px-1.5 py-0.5 leading-tight mt-0.5">
        {tip.action}
      </span>
      <span className="text-xs text-lavender/60 leading-relaxed">{tip.description}</span>
    </div>
  )
}

function TipSection({ section }: { section: TipSection }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-sm font-medium text-blush">{section.title}</span>
        {open ? (
          <ChevronDown size={14} className="text-lavender/40 shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-lavender/40 shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t border-white/5">
          {section.tips.map((tip, i) => (
            <TipRow key={i} tip={tip} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TipsAndTricks() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-8 py-6 border-b border-white/5">
        <h1 className="font-serif text-2xl text-blush">Tips & Tricks</h1>
        <p className="text-xs text-lavender/50 mt-1">
          Every feature, shortcut, and interaction in Aris.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-xl space-y-2">
          {TIP_SECTIONS.map((section) => (
            <TipSection key={section.title} section={section} />
          ))}
        </div>
      </div>
    </div>
  )
}
