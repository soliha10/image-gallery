import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import { backButton } from '../lib/telegram'
import { useStore } from '../lib/store'
import { CloseIcon } from './icons'

export function Search() {
  const setSheet = useStore((s) => s.setSheet)
  const setFilter = useStore((s) => s.setFilter)
  const setView = useStore((s) => s.setView)
  const filter = useStore((s) => s.filter)
  const total = useStore((s) => s.total)
  const [text, setText] = useState(filter.q ?? '')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => backButton(() => setSheet(null)), [setSheet])
  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    const q = text.trim() || undefined
    if (q === filter.q) return
    const timer = setTimeout(() => void setFilter({ q }), 280)
    return () => clearTimeout(timer)
  }, [filter.q, setFilter, text])

  return (
    <div className="sheet pad-top fixed inset-x-0 top-0 z-30 glass rounded-b-2xl px-4 pb-4 text-ink shadow-2xl">
      <div className="flex items-center gap-2">
        <input
          ref={input}
          value={text}
          maxLength={80}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              setView('grid')
              setSheet(null)
            }
          }}
          placeholder={t.searchPlaceholder}
          aria-label={t.search}
          enterKeyHint="search"
          className="h-11 min-w-0 flex-1 rounded-xl bg-bg px-4 text-base outline-none placeholder:text-hint focus:ring-2 focus:ring-accent"
        />
        <button onClick={() => setSheet(null)} aria-label={t.close} className="flex size-11 shrink-0 items-center justify-center">
          <CloseIcon />
        </button>
      </div>
      {filter.q && (
        <p className="mt-3 text-sm text-hint">
          {total > 0 ? `${total} ${t.photos}` : t.emptySearch}
        </p>
      )}
    </div>
  )
}
