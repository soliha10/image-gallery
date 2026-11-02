import type { Album, Me, Photo } from '@gallery/shared'
import { create } from 'zustand'
import { api, ApiError, type PhotoFilter } from './api'
import { language, setLanguage, type Language } from './i18n'
import { startGalleryToken } from './telegram'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

type Status = 'loading' | 'ready' | 'error' | 'outside'
export type View = 'room' | 'grid'
export type Sheet = 'search' | 'admin' | null

interface LightboxState {
  photos: Photo[]
  index: number
  from: Rect | null
}

export type Notice = 'linkExpired' | 'revoked' | 'linkCopied'

/** Someone else's gallery opened from their share link; it is read-only. */
interface Visit {
  token: string
  ownerName: string
}

interface State {
  status: Status
  language: Language
  visiting: Visit | null
  notice: Notice | null
  me: Me | null
  albums: Album[]
  photos: Photo[]
  total: number
  nextCursor: number | null
  loadingMore: boolean
  filter: PhotoFilter
  view: View
  webglFailed: boolean
  sheet: Sheet
  lightbox: LightboxState | null
  currentIndex: number
  setLanguage(language: Language): void
  leaveGallery(): Promise<void>
  setNotice(notice: Notice | null): void
  load(): Promise<void>
  loadMore(): Promise<void>
  setFilter(filter: PhotoFilter): Promise<void>
  refresh(): Promise<void>
  setView(view: View): void
  markWebglFailed(): void
  setSheet(sheet: Sheet): void
  openLightbox(photos: Photo[], index: number, from: Rect | null): void
  setLightboxIndex(index: number): void
  closeLightbox(): void
  setCurrentIndex(index: number): void
  toggleFavorite(id: string): void
}

const hasWebgl = () => {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** The share link is followed once; leaving the shared gallery must not reopen it. */
let pendingGallery = startGalleryToken()

export const useStore = create<State>((set, get) => ({
  status: 'loading',
  language,
  visiting: null,
  notice: null,
  me: null,
  albums: [],
  photos: [],
  total: 0,
  nextCursor: null,
  loadingMore: false,
  filter: {},
  view: hasWebgl() ? 'room' : 'grid',
  webglFailed: !hasWebgl(),
  sheet: null,
  lightbox: null,
  currentIndex: 0,

  setLanguage(next) {
    setLanguage(next)
    set({ language: next })
  },

  async leaveGallery() {
    set({ visiting: null, filter: {}, currentIndex: 0 })
    await get().load()
  },

  setNotice: (notice) => set({ notice }),

  async load() {
    set({ status: 'loading' })
    try {
      if (pendingGallery) {
        const token = pendingGallery
        pendingGallery = null
        const shared = await api.gallery(token).catch(() => null)
        // A revoked or mistyped link falls back to the viewer's own gallery, with a word about why.
        if (shared) set({ visiting: { token, ownerName: shared.ownerName }, filter: {} })
        else set({ notice: 'linkExpired' })
      }
      const gallery = get().visiting?.token
      const [me, albums, page] = await Promise.all([api.me(), api.albums(gallery), api.photos(get().filter, 0, gallery)])
      set({
        me,
        albums,
        photos: page.items,
        total: page.total,
        nextCursor: page.nextCursor ? Number(page.nextCursor) : null,
        status: 'ready',
      })
    } catch (error) {
      set({ status: error instanceof ApiError && error.status === 401 ? 'outside' : 'error' })
    }
  },

  async loadMore() {
    const { nextCursor, loadingMore, filter } = get()
    if (nextCursor === null || loadingMore) return
    set({ loadingMore: true })
    try {
      const page = await api.photos(filter, nextCursor, get().visiting?.token)
      if (get().filter !== filter) return
      set((s) => ({
        photos: [...s.photos, ...page.items],
        nextCursor: page.nextCursor ? Number(page.nextCursor) : null,
      }))
    } finally {
      set({ loadingMore: false })
    }
  },

  async setFilter(filter) {
    set({ filter, currentIndex: 0 })
    try {
      const page = await api.photos(filter, 0, get().visiting?.token)
      if (get().filter !== filter) return
      set({
        photos: page.items,
        total: page.total,
        nextCursor: page.nextCursor ? Number(page.nextCursor) : null,
      })
    } catch {
      set({ status: 'error' })
    }
  },

  async refresh() {
    const [albums, me] = await Promise.all([api.albums(), api.me(), get().setFilter({ ...get().filter })])
    set({ albums, me })
  },

  setView: (view) => set({ view }),
  markWebglFailed: () => set({ webglFailed: true, view: 'grid' }),
  setSheet: (sheet) => set({ sheet }),
  openLightbox: (photos, index, from) => set({ lightbox: { photos, index, from } }),
  setLightboxIndex: (index) => set((s) => (s.lightbox ? { lightbox: { ...s.lightbox, index } } : s)),
  closeLightbox: () => set({ lightbox: null }),
  setCurrentIndex: (currentIndex) => set({ currentIndex }),

  toggleFavorite(id) {
    const { me } = get()
    if (!me) return
    const on = !me.favoriteIds.includes(id)
    const update = (next: boolean) =>
      set((s) =>
        s.me
          ? {
              me: {
                ...s.me,
                favoriteIds: next ? [...s.me.favoriteIds, id] : s.me.favoriteIds.filter((f) => f !== id),
              },
            }
          : s,
      )
    update(on)
    api.favorite(id, on).catch(() => update(!on))
  },
}))
