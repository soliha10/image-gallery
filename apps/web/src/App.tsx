import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Admin } from './components/Admin'
import { Grid } from './components/Grid'
import { GearIcon, GridIcon, HeartIcon, RoomIcon, SearchIcon } from './components/icons'
import { Lightbox } from './components/Lightbox'
import { Search } from './components/Search'
import { CatGlyph, Loader, Message } from './components/States'
import { api } from './lib/api'
import { t } from './lib/i18n'
import { useStore } from './lib/store'
import { haptic, startPhotoId } from './lib/telegram'

const Scene3D = lazy(() => import('./scene/Scene3D'))

/** A failure inside the 3D scene drops to the grid instead of blanking the app. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    useStore.getState().markWebglFailed()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  const inRoom = useStore((s) => s.view === 'room')
  const idle = inRoom ? 'glass text-star' : 'bg-surface text-ink'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold whitespace-nowrap transition-colors ${
        active ? 'bg-gold text-void' : idle
      }`}
    >
      {label}
    </button>
  )
}

function Albums() {
  const albums = useStore((s) => s.albums)
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  return (
    <nav className="no-scrollbar absolute inset-x-0 top-0 z-10 flex gap-2 overflow-x-auto px-4 pt-[calc(var(--safe-top)+12px)]" aria-label={t.albums}>
      <Chip active={!filter.album && !filter.favorites} label={t.all} onClick={() => void setFilter({})} />
      {albums.map((album) => (
        <Chip key={album.id} active={filter.album === album.id} label={album.title} onClick={() => void setFilter({ album: album.id })} />
      ))}
    </nav>
  )
}

function Caption() {
  const photo = useStore((s) => s.photos[s.currentIndex])
  const [hinted, setHinted] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setHinted(true), 5000)
    return () => clearTimeout(timer)
  }, [])
  if (!photo) return null
  return (
    <div key={photo.id} className="rise pointer-events-none px-5 pb-2 text-star">
      <h1 className="font-display line-clamp-2 text-[22px] leading-tight font-semibold">{photo.title}</h1>
      <p className="mt-1 truncate text-[13px] text-star/75">
        {hinted ? photo.credit ?? photo.description : t.hint}
      </p>
    </div>
  )
}

function NavButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={() => {
        haptic.tap()
        onClick()
      }}
      aria-label={label}
      aria-pressed={active}
      className={`flex min-h-12 flex-1 items-center justify-center rounded-xl transition-colors ${active ? 'text-gold' : 'text-star/80'}`}
    >
      {children}
    </button>
  )
}

function BottomBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const webglFailed = useStore((s) => s.webglFailed)
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const setSheet = useStore((s) => s.setSheet)
  return (
    <div className="pad-bottom absolute inset-x-0 bottom-0 z-10 px-3">
      {view === 'room' && <Caption />}
      <nav className="glass flex rounded-2xl p-1 shadow-lg">
        {!webglFailed && (
          <NavButton label={view === 'room' ? t.grid : t.room} onClick={() => setView(view === 'room' ? 'grid' : 'room')}>
            {view === 'room' ? <GridIcon /> : <RoomIcon />}
          </NavButton>
        )}
        <NavButton label={t.search} onClick={() => setSheet('search')}>
          <SearchIcon />
        </NavButton>
        <NavButton label={t.favorites} active={filter.favorites} onClick={() => void setFilter(filter.favorites ? {} : { favorites: true })}>
          <HeartIcon filled={filter.favorites} />
        </NavButton>
        <NavButton label={t.admin} onClick={() => setSheet('admin')}>
          <GearIcon />
        </NavButton>
      </nav>
    </div>
  )
}

function Empty() {
  const filter = useStore((s) => s.filter)
  const setSheet = useStore((s) => s.setSheet)
  const fresh = !filter.favorites && !filter.q && !filter.album
  const body = filter.favorites ? t.emptyFavorites : filter.q ? t.emptySearch : t.emptyBody
  return (
    <div className="pointer-events-none absolute inset-x-6 top-[calc(var(--safe-top)+120px)] z-[5] flex justify-center">
      <div className="glass flex max-w-80 flex-col items-center rounded-2xl px-6 py-5 text-center text-star shadow-xl">
      <CatGlyph className="mb-3 w-16 text-gold" />
      <h2 className="font-display text-xl font-semibold">{fresh ? t.welcomeTitle : t.emptyTitle}</h2>
      <p className="mt-2 text-sm leading-relaxed text-star/80">{body}</p>
      {fresh && (
        <button
          onClick={() => setSheet('admin')}
          className="pointer-events-auto mt-5 min-h-11 rounded-full bg-gold px-6 text-sm font-bold text-void"
        >
          {t.upload}
        </button>
      )}
      </div>
    </div>
  )
}

function FallbackNotice() {
  const failed = useStore((s) => s.webglFailed)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000)
    return () => clearTimeout(timer)
  }, [failed])
  if (!failed || !visible) return null
  return (
    <p role="status" className="rise absolute inset-x-4 bottom-[calc(var(--safe-bottom)+84px)] z-20 glass rounded-xl px-4 py-2.5 text-center text-sm text-star">
      {t.fallback3d}
    </p>
  )
}

function Offline() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    addEventListener('online', update)
    addEventListener('offline', update)
    return () => {
      removeEventListener('online', update)
      removeEventListener('offline', update)
    }
  }, [])
  if (online) return null
  return (
    <p role="status" className="absolute inset-x-4 top-[calc(var(--safe-top)+60px)] z-20 glass rounded-xl px-4 py-2.5 text-center text-sm text-star">
      {t.offline}
    </p>
  )
}

export function App() {
  const status = useStore((s) => s.status)
  const load = useStore((s) => s.load)
  const view = useStore((s) => s.view)
  const sheet = useStore((s) => s.sheet)
  const empty = useStore((s) => s.photos.length === 0)
  const lightbox = useStore((s) => s.lightbox !== null)
  const openLightbox = useStore((s) => s.openLightbox)

  useEffect(() => {
    void load().then(async () => {
      const id = startPhotoId()
      if (!id) return
      const { photos } = useStore.getState()
      const index = photos.findIndex((p) => p.id === id)
      if (index >= 0) {
        openLightbox(photos, index, null)
      } else {
        const photo = await api.photo(id).catch(() => null)
        if (photo) openLightbox([photo], 0, null)
      }
    })
  }, [load, openLightbox])

  if (status === 'loading') return <Loader />
  if (status === 'outside') return <Message title={t.outsideTitle} body={t.outsideBody} />
  if (status === 'error') return <Message title={t.errorTitle} body={t.errorBody} action={() => void load()} />

  return (
    <main className="relative h-full overflow-hidden bg-void">
      {view === 'room' ? (
        <SceneBoundary>
          <Suspense fallback={<Loader />}>
            <Scene3D />
            <div className="room-vignette pointer-events-none absolute inset-0" />
          </Suspense>
        </SceneBoundary>
      ) : (
        !empty && <Grid />
      )}
      {empty && <Empty />}
      <Albums />
      <Offline />
      <FallbackNotice />
      <BottomBar />
      {sheet === 'search' && <Search />}
      {sheet === 'admin' && <Admin />}
      {lightbox && <Lightbox />}
    </main>
  )
}
