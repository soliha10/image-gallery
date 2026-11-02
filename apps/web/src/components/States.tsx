import { t } from '../lib/i18n'

export function CatGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} fill="none" aria-hidden>
      <path
        d="M20 72c-9 0-14-7-11-15 3-7 11-8 15-3M28 74c-4-20 8-36 30-36h14l3-13 12 9c8 2 13 9 13 17 0 14-12 23-28 23H28Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M84 54c2-2 5-2 7 0" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Loader() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 starfield text-gold" role="status">
      <CatGlyph className="w-20" />
      <div className="flex gap-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="paw size-2.5 rounded-full bg-current" style={{ animationDelay: `${i * 0.14}s` }} />
        ))}
      </div>
      <p className="text-sm text-star/70">{t.loading}</p>
    </div>
  )
}

export function Message({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center starfield px-8 text-center text-star">
      <CatGlyph className="mb-6 w-28 text-gold" />
      <h1 className="font-display text-2xl leading-tight font-semibold">{title}</h1>
      <p className="mt-3 max-w-72 text-sm leading-relaxed text-star/70">{body}</p>
      {action && (
        <button onClick={action} className="mt-7 min-h-11 rounded-full bg-gold px-6 text-sm font-bold text-void">
          {t.retry}
        </button>
      )}
    </div>
  )
}
