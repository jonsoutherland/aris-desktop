import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Search,
  Network,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { useStore } from '../store'
import NoteNode from './NoteNode'
import type { Note, NoteLink } from '../types'

const NODE_WIDTH = 180

const SOURCE_PALETTE = [
  '#2978a0', '#7fbeab', '#a07fb0', '#d4916a',
  '#6a9fcc', '#cc7f8a', '#6ab87f', '#cc9f6a',
]

const nodeTypes = { noteNode: NoteNode }

type HistoryEntry =
  | { type: 'addEdge'; fromId: string; toId: string }
  | { type: 'deleteEdge'; fromId: string; toId: string }

function buildNodes(
  notes: Note[],
  sourceColors: Map<string, string>,
  positions: Map<string, { x: number; y: number }>,
  filterIds?: Set<string>
): Node[] {
  const filtered = filterIds ? notes.filter((n) => filterIds.has(n.id)) : notes
  return filtered.map((note, i) => ({
    id: note.id,
    type: 'noteNode',
    position: positions.get(note.id) ?? {
      x: (i % 5) * (NODE_WIDTH + 40) + 40,
      y: Math.floor(i / 5) * (70 + 40) + 40,
    },
    data: {
      label: note.term,
      color: sourceColors.get(note.source_id) ?? SOURCE_PALETTE[0],
      animating: false,
    },
    style: { width: NODE_WIDTH },
  }))
}

function buildEdges(noteLinks: NoteLink[], filterIds?: Set<string>): Edge[] {
  return noteLinks
    .filter(
      (l) =>
        !filterIds ||
        (filterIds.has(l.from_note_id) && filterIds.has(l.to_note_id))
    )
    .map((l) => ({
      id: `${l.from_note_id}-${l.to_note_id}`,
      source: l.from_note_id,
      target: l.to_note_id,
      label: l.relationship ?? undefined,
      style: { stroke: '#2978a0', strokeWidth: 1.5 },
      labelStyle: { fill: '#aea3b0', fontSize: 11 },
    }))
}

function GraphContent() {
  const {
    notes,
    noteLinks,
    sources,
    nodePositions,
    addNoteLink,
    deleteNoteLink,
    saveNodePosition,
    graphs,
    activeGraphId,
    loadNoteLinks,
    loadNodePositions,
    createGraph,
    renameGraph,
    deleteGraph,
    setActiveGraph,
  } = useStore()

  const { zoomIn, zoomOut, screenToFlowPosition } = useReactFlow()

  const [search, setSearch] = useState('')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [toolbarOpen, setToolbarOpen] = useState(true)
  const [sourcesOpen, setSourcesOpen] = useState(true)
  const [locked, setLocked] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set())
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())
  const [sortMode, setSortMode] = useState<Record<string, 'name' | 'page'>>({})
  const [isConnecting, setIsConnecting] = useState(false)

  // Graph picker state
  const [graphPickerOpen, setGraphPickerOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)
  const [newGraphName, setNewGraphName] = useState('')
  const graphPickerRef = useRef<HTMLDivElement>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const userMovedNodes = useRef<Set<string>>(new Set())
  const pendingPositions = useRef<Map<string, { x: number; y: number }>>(new Map())

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Reload graph data when active graph switches; also clear undo/redo
  useEffect(() => {
    if (!activeGraphId) return
    loadNoteLinks()
    loadNodePositions()
    setUndoStack([])
    setRedoStack([])
    userMovedNodes.current.clear()
    pendingPositions.current.clear()
  }, [activeGraphId])

  // Close graph picker on outside click
  useEffect(() => {
    if (!graphPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (graphPickerRef.current && !graphPickerRef.current.contains(e.target as HTMLElement)) {
        setGraphPickerOpen(false)
        setRenamingId(null)
        setCreatingNew(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [graphPickerOpen])

  const sourceColors = useMemo(() => {
    const map = new Map<string, string>()
    sources.forEach((s, i) => map.set(s.id, SOURCE_PALETTE[i % SOURCE_PALETTE.length]))
    return map
  }, [sources])

  const filteredIds = useMemo(() => {
    if (!search.trim()) return undefined
    const q = search.toLowerCase()
    return new Set(
      notes
        .filter(
          (n) =>
            n.term.toLowerCase().includes(q) || n.definition.toLowerCase().includes(q)
        )
        .map((n) => n.id)
    )
  }, [notes, search])

  const visibleNotes = useMemo(
    () => notes.filter((n) => !hiddenSources.has(n.source_id)),
    [notes, hiddenSources]
  )

  const dbPositions = useMemo(
    () => new Map(nodePositions.map((p) => [p.note_id, { x: p.x, y: p.y }])),
    [nodePositions]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(
    buildNodes(notes, sourceColors, dbPositions, filteredIds)
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    buildEdges(noteLinks, filteredIds)
  )

  // Sync nodes: DB positions override grid defaults; user-moved and pending override DB
  useEffect(() => {
    setNodes((prev) => {
      const prevMap = new Map(prev.map((n) => [n.id, n]))
      const prevPositions = new Map(prev.map((n) => [n.id, n.position]))
      const merged = new Map([...prevPositions, ...dbPositions])

      // Pending positions for notes just made visible via drag-drop
      for (const [id, p] of pendingPositions.current) {
        merged.set(id, p)
        if (prevPositions.has(id)) pendingPositions.current.delete(id)
      }

      // User-moved nodes keep their current position from prev
      for (const id of userMovedNodes.current) {
        const p = prevPositions.get(id)
        if (p) merged.set(id, p)
      }

      return buildNodes(visibleNotes, sourceColors, merged, filteredIds).map((n) => ({
        ...n,
        data: {
          ...n.data,
          animating: (prevMap.get(n.id)?.data as { animating?: boolean })?.animating ?? false,
        },
      }))
    })
  }, [visibleNotes, filteredIds, sourceColors, dbPositions])

  // Sync edges — filter to only nodes currently visible
  useEffect(() => {
    const visibleIds = new Set(visibleNotes.map((n) => n.id))
    const filterSet = filteredIds
      ? new Set([...filteredIds].filter((id) => visibleIds.has(id)))
      : hiddenSources.size > 0
        ? visibleIds
        : undefined
    setEdges(buildEdges(noteLinks, filterSet))
  }, [noteLinks, filteredIds, visibleNotes, hiddenSources])

  const handleUndo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1]
    if (!last) return
    setUndoStack((s) => s.slice(0, -1))
    if (last.type === 'addEdge') {
      setEdges((eds) => eds.filter((e) => !(e.source === last.fromId && e.target === last.toId)))
      await deleteNoteLink(last.fromId, last.toId)
    } else {
      await addNoteLink(last.fromId, last.toId)
    }
    setRedoStack((s) => [...s, last])
  }, [undoStack, deleteNoteLink, addNoteLink, setEdges])

  const handleRedo = useCallback(async () => {
    const last = redoStack[redoStack.length - 1]
    if (!last) return
    setRedoStack((s) => s.slice(0, -1))
    if (last.type === 'addEdge') {
      await addNoteLink(last.fromId, last.toId)
    } else {
      setEdges((eds) => eds.filter((e) => !(e.source === last.fromId && e.target === last.toId)))
      await deleteNoteLink(last.fromId, last.toId)
    }
    setUndoStack((s) => [...s, last])
  }, [redoStack, deleteNoteLink, addNoteLink, setEdges])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      } else if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleRedo])

  const onConnect = useCallback(
    async (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) return
      if (
        edges.some(
          (e) =>
            (e.source === params.source && e.target === params.target) ||
            (e.source === params.target && e.target === params.source)
        )
      )
        return

      // Animate border glow on both connected nodes
      const animIds = new Set([params.source, params.target])
      setNodes((nds) =>
        nds.map((n) =>
          animIds.has(n.id) ? { ...n, data: { ...n.data, animating: true } } : n
        )
      )
      setTimeout(() => {
        setNodes((nds) =>
          nds.map((n) =>
            animIds.has(n.id) ? { ...n, data: { ...n.data, animating: false } } : n
          )
        )
      }, 2100)

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: `${params.source}-${params.target}`,
            style: { stroke: '#2978a0', strokeWidth: 1.5 },
          },
          eds
        )
      )
      await addNoteLink(params.source, params.target)
      setUndoStack((s) => [...s, { type: 'addEdge', fromId: params.source!, toId: params.target! }])
      setRedoStack([])
    },
    [edges, addNoteLink, setEdges, setNodes]
  )

  const handleDeleteEdge = useCallback(
    async (edgeId: string) => {
      const edge = edges.find((e) => e.id === edgeId)
      if (!edge) return
      setEdges((eds) => eds.filter((e) => e.id !== edgeId))
      await deleteNoteLink(edge.source, edge.target)
      setUndoStack((s) => [...s, { type: 'deleteEdge', fromId: edge.source, toId: edge.target }])
      setRedoStack([])
    },
    [edges, deleteNoteLink, setEdges]
  )

  const toggleSourceVisibility = useCallback((sourceId: string) => {
    setHiddenSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((sourceId: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const noteId = e.dataTransfer.getData('noteId')
      if (!noteId) return
      const note = notes.find((n) => n.id === noteId)
      if (!note) return

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      pendingPositions.current.set(noteId, position)
      userMovedNodes.current.add(noteId)

      if (hiddenSources.has(note.source_id)) {
        // Reveal the source so the node appears; sync effect will use pendingPositions
        setHiddenSources((prev) => {
          const next = new Set(prev)
          next.delete(note.source_id)
          return next
        })
      } else {
        setNodes((nds) =>
          nds.map((n) => (n.id === noteId ? { ...n, position } : n))
        )
      }
      saveNodePosition(noteId, position.x, position.y)
    },
    [notes, hiddenSources, screenToFlowPosition, saveNodePosition, setNodes]
  )

  const handleCreateGraph = useCallback(async () => {
    const name = newGraphName.trim()
    if (!name) return
    const graph = await createGraph(name)
    setActiveGraph(graph.id)
    setNewGraphName('')
    setCreatingNew(false)
    setGraphPickerOpen(false)
  }, [newGraphName, createGraph, setActiveGraph])

  const handleRenameGraph = useCallback(async (id: string) => {
    const name = renameText.trim()
    if (name) await renameGraph(id, name)
    setRenamingId(null)
  }, [renameText, renameGraph])

  const handleDeleteGraph = useCallback(async (id: string) => {
    await deleteGraph(id)
    setGraphPickerOpen(false)
  }, [deleteGraph])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  const selectedNote = notes.find((n) => n.id === selectedNode)

  if (notes.length === 0) {
    return (
      <div className="h-full flex items-center justify-center flex-col gap-3 text-lavender/40">
        <Network size={48} strokeWidth={1} />
        <p className="text-sm">Take notes to start building your knowledge graph.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
        {/* Graph picker */}
        <div className="relative" ref={graphPickerRef}>
          <button
            onClick={() => setGraphPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-serif font-bold text-blush hover:bg-white/5 transition-colors max-w-[200px]"
          >
            <Network size={14} className="text-ocean shrink-0" />
            <span className="truncate">
              {graphs.find((g) => g.id === activeGraphId)?.name ?? 'Knowledge Graph'}
            </span>
            <ChevronDown size={11} className={`shrink-0 text-lavender/40 transition-transform ${graphPickerOpen ? 'rotate-180' : ''}`} />
          </button>

          {graphPickerOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-[#1e2535] border border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="max-h-64 overflow-y-auto py-1">
                {graphs.map((g) => (
                  <div
                    key={g.id}
                    className={`flex items-center gap-2 px-3 py-2 group ${g.id === activeGraphId ? 'bg-ocean/10' : 'hover:bg-white/5'}`}
                  >
                    {renamingId === g.id ? (
                      <input
                        autoFocus
                        value={renameText}
                        onChange={(e) => setRenameText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameGraph(g.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 bg-white/10 border border-ocean/40 rounded px-2 py-0.5 text-xs text-blush outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => { setActiveGraph(g.id); setGraphPickerOpen(false) }}
                        className="flex-1 text-left text-xs text-blush truncate"
                      >
                        {g.name}
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {renamingId === g.id ? (
                        <button
                          onClick={() => handleRenameGraph(g.id)}
                          className="p-1 text-sage hover:text-sage/70 transition-colors"
                        >
                          <Check size={11} />
                        </button>
                      ) : (
                        <button
                          onClick={() => { setRenamingId(g.id); setRenameText(g.name) }}
                          className="p-1 text-lavender/0 group-hover:text-lavender/40 hover:!text-lavender transition-colors"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteGraph(g.id)}
                        disabled={graphs.length <= 1}
                        className="p-1 text-lavender/0 group-hover:text-lavender/40 hover:!text-red-400 disabled:opacity-0 transition-colors"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/5 p-2">
                {creatingNew ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      placeholder="Graph name…"
                      value={newGraphName}
                      onChange={(e) => setNewGraphName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateGraph()
                        if (e.key === 'Escape') { setCreatingNew(false); setNewGraphName('') }
                      }}
                      className="flex-1 bg-white/10 border border-ocean/40 rounded px-2 py-1 text-xs text-blush outline-none placeholder-lavender/30"
                    />
                    <button onClick={handleCreateGraph} className="p-1 text-sage">
                      <Check size={13} />
                    </button>
                    <button onClick={() => { setCreatingNew(false); setNewGraphName('') }} className="p-1 text-lavender/40">
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setCreatingNew(true)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-lavender/60 hover:text-blush hover:bg-white/5 transition-colors"
                  >
                    <Plus size={12} />
                    New graph
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-lavender/40"
          />
          <input
            type="text"
            placeholder="Filter concepts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-blush outline-none focus:border-ocean/50 w-44"
          />
        </div>
        <p className="text-xs text-lavender/30 ml-auto">
          Drag bottom handle to link · double-click edge to remove
        </p>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Left toolbar */}
        <div
          className={`flex flex-col shrink-0 border-r border-white/5 bg-ink transition-all duration-200 overflow-hidden ${
            toolbarOpen ? 'w-48' : 'w-10'
          }`}
        >
          {/* Collapse toggle */}
          <button
            onClick={() => setToolbarOpen((o) => !o)}
            title={toolbarOpen ? 'Collapse toolbar' : 'Expand toolbar'}
            className="flex items-center justify-center h-9 w-full text-lavender/40 hover:text-blush transition-colors shrink-0 border-b border-white/5"
          >
            {toolbarOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>

          {/* Tool buttons */}
          <div className="flex flex-col gap-0.5 p-1.5 shrink-0">
            <ToolBtn icon={<ZoomIn size={14} />} label="Zoom In" open={toolbarOpen} onClick={() => zoomIn()} />
            <ToolBtn icon={<ZoomOut size={14} />} label="Zoom Out" open={toolbarOpen} onClick={() => zoomOut()} />
            <ToolBtn
              icon={locked ? <Lock size={14} /> : <LockOpen size={14} />}
              label={locked ? 'Locked' : 'Lock'}
              open={toolbarOpen}
              active={locked}
              onClick={() => setLocked((l) => !l)}
            />
            <ToolBtn
              icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              open={toolbarOpen}
              onClick={toggleFullscreen}
            />
            <div className="my-1 border-t border-white/5" />
            <ToolBtn
              icon={<RotateCcw size={14} />}
              label="Undo"
              hint="Ctrl+Z"
              open={toolbarOpen}
              disabled={undoStack.length === 0}
              onClick={handleUndo}
            />
            <ToolBtn
              icon={<RotateCw size={14} />}
              label="Redo"
              hint="Ctrl+Y"
              open={toolbarOpen}
              disabled={redoStack.length === 0}
              onClick={handleRedo}
            />
          </div>

          {/* Sources section */}
          {toolbarOpen && sources.length > 0 && (
            <div className="mt-1 border-t border-white/5 flex flex-col min-h-0 overflow-hidden">
              <button
                onClick={() => setSourcesOpen((o) => !o)}
                className="flex items-center justify-between w-full px-3 py-2 text-xs text-lavender/50 hover:text-lavender/80 transition-colors shrink-0"
              >
                <span>Sources</span>
                {sourcesOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>

              {sourcesOpen && (
                <div className="overflow-y-auto flex-1">
                  {sources.map((source, i) => {
                    const color = SOURCE_PALETTE[i % SOURCE_PALETTE.length]
                    const isHidden = hiddenSources.has(source.id)
                    const isExpanded = expandedSources.has(source.id)
                    const sort = sortMode[source.id] ?? 'page'
                    const sourceNotes = notes
                      .filter((n) => n.source_id === source.id)
                      .slice()
                      .sort(
                        sort === 'name'
                          ? (a, b) => a.term.localeCompare(b.term)
                          : (a, b) => (a.page_number ?? 0) - (b.page_number ?? 0)
                      )

                    return (
                      <div key={source.id}>
                        {/* Source row */}
                        <div className="flex items-center gap-2 px-3 py-1.5">
                          {/* Visibility toggle */}
                          <button
                            onClick={() => toggleSourceVisibility(source.id)}
                            title={isHidden ? 'Show notes' : 'Hide notes'}
                            className="shrink-0 w-2.5 h-2.5 rounded-full transition-all hover:opacity-80"
                            style={
                              isHidden
                                ? { border: `2px solid ${color}`, background: 'transparent' }
                                : { background: color }
                            }
                          />
                          {/* Expand dropdown */}
                          <button
                            onClick={() => toggleExpanded(source.id)}
                            className="flex items-center gap-1 flex-1 min-w-0 text-left group"
                          >
                            <span className="text-xs text-lavender/60 group-hover:text-lavender/90 truncate flex-1 transition-colors">
                              {source.title}
                            </span>
                            {isExpanded ? (
                              <ChevronUp size={9} className="text-lavender/30 shrink-0" />
                            ) : (
                              <ChevronDown size={9} className="text-lavender/30 shrink-0" />
                            )}
                          </button>
                        </div>

                        {/* Note list dropdown */}
                        {isExpanded && (
                          <div className="pb-1.5">
                            {/* Sort toggle */}
                            <div className="flex gap-1 px-3 mb-1">
                              <button
                                onClick={() =>
                                  setSortMode((m) => ({ ...m, [source.id]: 'name' }))
                                }
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                  sort === 'name'
                                    ? 'bg-ocean/20 text-ocean'
                                    : 'text-lavender/30 hover:text-lavender/60'
                                }`}
                              >
                                A–Z
                              </button>
                              <button
                                onClick={() =>
                                  setSortMode((m) => ({ ...m, [source.id]: 'page' }))
                                }
                                className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                                  sort === 'page'
                                    ? 'bg-ocean/20 text-ocean'
                                    : 'text-lavender/30 hover:text-lavender/60'
                                }`}
                              >
                                Page
                              </button>
                            </div>

                            {/* Draggable note terms */}
                            {sourceNotes.map((note) => (
                              <div
                                key={note.id}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('noteId', note.id)
                                  e.dataTransfer.effectAllowed = 'move'
                                }}
                                className="px-3 py-0.5 text-xs text-lavender/50 hover:text-blush hover:bg-white/5 cursor-grab truncate transition-colors"
                              >
                                {note.term}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Graph canvas + right inspector */}
        <div
          className="flex-1 flex min-w-0 min-h-0"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={() => setIsConnecting(true)}
            onConnectEnd={() => setIsConnecting(false)}
            onNodeClick={(_, node) => setSelectedNode(node.id)}
            onPaneClick={() => setSelectedNode(null)}
            onEdgeDoubleClick={(_, edge) => handleDeleteEdge(edge.id)}
            onNodeDragStop={(_, node) => {
              userMovedNodes.current.add(node.id)
              saveNodePosition(node.id, node.position.x, node.position.y)
            }}
            nodeTypes={nodeTypes}
            connectionRadius={130}
            isValidConnection={(c) => c.source !== c.target}
            nodesDraggable={!locked}
            nodesConnectable={!locked}
            fitView
            className={`flex-1${isConnecting ? ' rf-connecting' : ''}`}
            style={{ background: '#181d27' }}
          >
            <Background color="#2978a010" variant={BackgroundVariant.Dots} />
            <MiniMap
              style={{
                background: '#181d27',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
              }}
              nodeColor={(node) => (node.data as { color: string }).color}
            />
          </ReactFlow>

          {/* Node inspector */}
          {selectedNote && (
            <div className="w-64 border-l border-white/10 bg-ink flex flex-col p-4 gap-4 overflow-y-auto shrink-0">
              <div>
                <p className="text-xs text-lavender/40 mb-1">Term</p>
                <p className="font-serif text-blush font-bold">{selectedNote.term}</p>
              </div>
              <div>
                <p className="text-xs text-lavender/40 mb-1">Definition</p>
                <p className="text-sm text-blush/80 leading-relaxed">{selectedNote.definition}</p>
              </div>
              {selectedNote.page_number && (
                <div>
                  <p className="text-xs text-lavender/40 mb-1">Source</p>
                  <p className="text-xs text-sage">
                    {sources.find((s) => s.id === selectedNote.source_id)?.title} · p.{' '}
                    {selectedNote.page_number}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-lavender/40 mb-2">Linked concepts</p>
                {noteLinks
                  .filter(
                    (l) =>
                      l.from_note_id === selectedNote.id || l.to_note_id === selectedNote.id
                  )
                  .map((l) => {
                    const otherId =
                      l.from_note_id === selectedNote.id ? l.to_note_id : l.from_note_id
                    const other = notes.find((n) => n.id === otherId)
                    return (
                      <div
                        key={`${l.from_note_id}-${l.to_note_id}`}
                        className="flex items-center justify-between py-1"
                      >
                        <span className="text-xs text-ocean truncate">{other?.term}</span>
                        <button
                          onClick={() => deleteNoteLink(l.from_note_id, l.to_note_id)}
                          className="text-lavender/30 hover:text-red-400 transition-colors ml-2"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolBtn({
  icon,
  label,
  hint,
  open,
  active,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  open: boolean
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={open ? undefined : label}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors w-full whitespace-nowrap ${
        disabled
          ? 'text-lavender/20 cursor-not-allowed'
          : active
            ? 'text-ocean bg-ocean/10 hover:bg-ocean/15'
            : 'text-lavender/50 hover:text-blush hover:bg-white/5'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {open && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {hint && <span className="text-lavender/30 text-[10px] shrink-0">{hint}</span>}
        </>
      )}
    </button>
  )
}

export default function VisualGraph() {
  return (
    <ReactFlowProvider>
      <GraphContent />
    </ReactFlowProvider>
  )
}
