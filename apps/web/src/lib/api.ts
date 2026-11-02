import type { Album, Language, Me, Photo, PhotoPage, Share, SharedGallery } from '@gallery/shared'
import { tg } from './telegram'

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API error ${status}`)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `tma ${tg?.initData ?? ''}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, { ...init, headers })
  if (!response.ok) throw new ApiError(response.status)
  return (response.status === 204 ? undefined : await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export interface PhotoFilter {
  album?: string
  q?: string
  favorites?: boolean
}

export const api = {
  me: () => request<Me>('/me'),
  albums: (gallery?: string) => request<Album[]>(gallery ? `/albums?gallery=${gallery}` : '/albums'),
  /** `gallery` reads someone else's shared gallery instead of the viewer's own. */
  photos({ album, q, favorites }: PhotoFilter, cursor: number, gallery?: string) {
    const params = new URLSearchParams({ cursor: String(cursor) })
    if (gallery) params.set('gallery', gallery)
    if (album) params.set('album', album)
    if (q) params.set('q', q)
    if (favorites) params.set('favorites', '1')
    return request<PhotoPage>(`/photos?${params}`)
  },
  photo: (id: string) => request<Photo>(`/photos/${id}`),
  gallery: (token: string) => request<SharedGallery>(`/galleries/${token}`),
  share: () => request<Share>('/share'),
  createShare: () => request<Share>('/share', { method: 'POST' }),
  revokeShare: () => request<void>('/share', { method: 'DELETE' }),
  setLanguage: (language: Language) => request<void>('/language', json('PUT', { language })),
  favorite: (id: string, on: boolean) => request<void>(`/photos/${id}/favorite`, { method: on ? 'PUT' : 'DELETE' }),
  upload(file: File, albumId?: string) {
    const body = new FormData()
    if (albumId) body.set('albumId', albumId)
    body.set('file', file)
    return request<Photo>('/admin/photos', { method: 'POST', body })
  },
  updatePhoto: (id: string, patch: Partial<Pick<Photo, 'title' | 'description' | 'albumId'>>) =>
    request<Photo>(`/admin/photos/${id}`, json('PATCH', patch)),
  deletePhoto: (id: string) => request<void>(`/admin/photos/${id}`, { method: 'DELETE' }),
  reorderPhotos: (ids: string[]) => request<void>('/admin/photos/reorder', json('POST', { ids })),
  createAlbum: (title: string) => request<void>('/admin/albums', json('POST', { title })),
  renameAlbum: (id: string, title: string) => request<void>(`/admin/albums/${id}`, json('PATCH', { title })),
  deleteAlbum: (id: string) => request<void>(`/admin/albums/${id}`, { method: 'DELETE' }),
}
