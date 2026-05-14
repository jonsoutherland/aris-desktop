import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import ePub from 'epubjs'
import { X, Check, Image } from 'lucide-react'
import type { KnowledgeSource } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

interface Props {
  source: KnowledgeSource
  onSelect: (dataUrl: string) => void
  onSkip: () => void
}

const THUMB_SCALE = 0.3
const COVER_SCALE = 0.65
const MAX_PAGES = 30

export default function CoverPickerModal({ source, onSelect, onSkip }: Props) {
  const [thumbs, setThumbs] = useState<Array<{ page: number; url: string }>>([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [loadingThumbs, setLoadingThumbs] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [epubCover, setEpubCover] = useState<string | null>(null)
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const cancelledRef = useRef(false)
  const runIdRef = useRef(0)

  useEffect(() => {
    cancelledRef.current = false
    if (source.type === 'pdf') loadPdf()
    else loadEpubCover()
    return () => {
      cancelledRef.current = true
      runIdRef.current++
      try { pdfRef.current?.destroy() } catch {}
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc to skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkip() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSkip])

  async function loadPdf() {
    const runId = ++runIdRef.current
    setThumbs([])
    try {
      const pdf = await pdfjsLib.getDocument(`file://${source.file_path}`).promise
      if (cancelledRef.current || runId !== runIdRef.current) { pdf.destroy(); return }
      pdfRef.current = pdf
      setTotal(pdf.numPages)
      const pageCount = Math.min(pdf.numPages, MAX_PAGES)
      for (let i = 1; i <= pageCount; i++) {
        if (cancelledRef.current || runId !== runIdRef.current) break
        try {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: THUMB_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width = vp.width
          canvas.height = vp.height
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
          if (!cancelledRef.current && runId === runIdRef.current)
            setThumbs((prev) => [...prev, { page: i, url: canvas.toDataURL('image/jpeg', 0.8) }])
        } catch {}
      }
    } catch {}
    if (!cancelledRef.current && runId === runIdRef.current) setLoadingThumbs(false)
  }

  async function loadEpubCover() {
    try {
      const book = ePub(`file://${source.file_path}`)
      await (book as any).ready
      const blobUrl: string | null = await (book as any).coverUrl()
      if (blobUrl && !cancelledRef.current) {
        const resp = await fetch(blobUrl)
        const blob = await resp.blob()
        const b64 = await new Promise<string>((res) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result as string)
          reader.readAsDataURL(blob)
        })
        if (!cancelledRef.current) setEpubCover(b64)
      }
      try { (book as any).destroy() } catch {}
    } catch {}
    if (!cancelledRef.current) setLoadingThumbs(false)
  }

  async function handleConfirm() {
    if (source.type === 'epub') {
      if (epubCover) onSelect(epubCover)
      else onSkip()
      return
    }
    if (selected === null || !pdfRef.current) return
    setConfirming(true)
    try {
      const page = await pdfRef.current.getPage(selected)
      const vp = page.getViewport({ scale: COVER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = vp.width
      canvas.height = vp.height
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      onSelect(canvas.toDataURL('image/jpeg', 0.88))
    } catch { onSkip() }
  }

  const canConfirm = !confirming && (
    source.type === 'pdf' ? selected !== null : (!loadingThumbs && epubCover !== null)
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[700px] max-w-[92vw] max-h-[82vh] bg-ink border border-white/10 rounded-xl shadow-2xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 shrink-0">
          <div>
            <h2 className="font-serif text-lg text-blush">Choose a cover</h2>
            <p className="text-xs text-lavender/40 mt-0.5">
              {source.type === 'pdf'
                ? total > MAX_PAGES
                  ? `Showing first ${MAX_PAGES} of ${total} pages — pick one to use as the thumbnail`
                  : 'Pick any page to use as the library thumbnail'
                : 'Use the embedded cover image from this EPUB'}
            </p>
          </div>
          <button onClick={onSkip} className="p-1 text-lavender/40 hover:text-blush transition-colors rounded">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {source.type === 'pdf' ? (
            <div className="grid grid-cols-4 gap-3">
              {thumbs.map(({ page, url }) => (
                <button
                  key={page}
                  onClick={() => setSelected(page)}
                  className={`relative rounded-lg overflow-hidden border-2 transition-all focus:outline-none ${
                    selected === page
                      ? 'border-ocean shadow-lg shadow-ocean/20 scale-[1.02]'
                      : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  <img src={url} alt={`Page ${page}`} className="w-full h-auto block" />
                  <span className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-white/50 bg-black/40 py-0.5">
                    {page}
                  </span>
                  {selected === page && (
                    <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-ocean rounded-full flex items-center justify-center shadow">
                      <Check size={11} className="text-white" />
                    </div>
                  )}
                </button>
              ))}
              {/* Skeletons while rendering */}
              {loadingThumbs && thumbs.length === 0 &&
                Array.from({ length: 8 }).map((_, i) => (
                  <div key={`sk-${i}`} className="aspect-[3/4] bg-white/5 rounded-lg animate-pulse" />
                ))}
              {loadingThumbs && thumbs.length > 0 && (
                <div className="aspect-[3/4] bg-white/5 rounded-lg animate-pulse" />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-52 gap-4 py-6">
              {loadingThumbs ? (
                <div className="w-44 aspect-[2/3] bg-white/5 rounded-xl animate-pulse" />
              ) : epubCover ? (
                <img
                  src={epubCover}
                  alt="Cover"
                  className="max-h-72 rounded-xl shadow-2xl ring-2 ring-ocean/30"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-lavender/40">
                  <Image size={32} strokeWidth={1} />
                  <p className="text-sm">No embedded cover found in this EPUB.</p>
                  <p className="text-xs opacity-70">You can skip and set a cover later from the library.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/5 shrink-0">
          <button
            onClick={onSkip}
            className="text-xs text-lavender/60 hover:text-blush px-3 py-1.5 rounded transition-colors"
          >
            Skip
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 bg-ocean text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-ocean/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={12} />
            {confirming ? 'Saving…' : 'Use this page'}
          </button>
        </div>
      </div>
    </div>
  )
}
