import { photoUrl, type Photo } from '@gallery/shared'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { t } from '../lib/i18n'
import { backButton, confirm, haptic, mainButton } from '../lib/telegram'
import { useStore } from '../lib/store'
import { CloseIcon } from './icons'

const field =
  'h-11 w-full min-w-0 rounded-xl bg-bg px-3 text-base text-ink outline-none placeholder:text-hint focus:ring-2 focus:ring-accent'
const smallButton = 'min-h-11 rounded-lg px-3 text-sm font-semibold'

function PhotoRow({
  photo,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  photo: Photo
  onMove: (delta: number) => void
  canMoveUp: boolean
  canMoveDown: boolean
}) {
  const albums = useStore((s) => s.albums)
  const refresh = useStore((s) => s.refresh)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(photo.title)
  const [description, setDescription] = useState(photo.description)
  const [albumId, setAlbumId] = useState(photo.albumId ?? '')

  const save = async () => {
    await api.updatePhoto(photo.id, { title, description, albumId: albumId || null })
    setEditing(false)
    haptic.success()
    await refresh()
  }

  const remove = async () => {
    if (!(await confirm(t.confirmDeletePhoto))) return
    await api.deletePhoto(photo.id)
    await refresh()
  }

  return (
    <li className="border-b border-hint/15 py-2">
      <div className="flex items-center gap-3">
        <img src={photoUrl(photo, 400)} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />
        <button onClick={() => setEditing(!editing)} aria-expanded={editing} className="min-h-11 min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold">{photo.title || '—'}</span>
          <span className="block truncate text-xs text-hint">{albums.find((a) => a.id === photo.albumId)?.title ?? t.noAlbum}</span>
        </button>
        <button disabled={!canMoveUp} onClick={() => onMove(-1)} aria-label={t.moveUp} className="size-11 shrink-0 text-lg disabled:opacity-25">↑</button>
        <button disabled={!canMoveDown} onClick={() => onMove(1)} aria-label={t.moveDown} className="size-11 shrink-0 text-lg disabled:opacity-25">↓</button>
      </div>
      {editing && (
        <div className="rise mt-2 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={t.title} aria-label={t.title} className={field} />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder={t.description}
            aria-label={t.description}
            className={`${field} h-auto py-2`}
          />
          <select value={albumId} onChange={(e) => setAlbumId(e.target.value)} aria-label={t.albums} className={field}>
            <option value="">{t.noAlbum}</option>
            {albums.map((album) => (
              <option key={album.id} value={album.id}>{album.title}</option>
            ))}
          </select>
          <div className="flex justify-between">
            <button onClick={() => void remove()} className={`${smallButton} text-danger`}>{t.remove}</button>
            <button onClick={() => void save()} className={`${smallButton} bg-accent text-on-accent`}>{t.save}</button>
          </div>
        </div>
      )}
    </li>
  )
}

export function Admin() {
  const setSheet = useStore((s) => s.setSheet)
  const albums = useStore((s) => s.albums)
  const photos = useStore((s) => s.photos)
  const filter = useStore((s) => s.filter)
  const refresh = useStore((s) => s.refresh)
  const me = useStore((s) => s.me)
  const [albumTitle, setAlbumTitle] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => backButton(() => setSheet(null)), [setSheet])
  useEffect(() => mainButton(t.upload, () => file.current?.click()) ?? undefined, [])

  const upload = async (files: File[]) => {
    let failed = 0
    let full = false
    for (const [i, item] of files.entries()) {
      setProgress(`${t.uploading} ${i + 1}/${files.length}`)
      await api.upload(item, filter.album).catch((error: unknown) => {
        failed++
        if (error instanceof ApiError && error.status === 409) full = true
      })
    }
    setProgress(full ? t.galleryFull : failed ? `${failed} ${t.uploadFailed}` : null)
    if (!failed) haptic.success()
    await refresh()
  }

  const addAlbum = async () => {
    if (!albumTitle.trim()) return
    await api.createAlbum(albumTitle)
    setAlbumTitle('')
    await refresh()
  }

  const renameAlbum = async (id: string, title: string) => {
    if (title.trim()) await api.renameAlbum(id, title)
    await refresh()
  }

  const removeAlbum = async (id: string) => {
    if (!(await confirm(t.confirmDeleteAlbum))) return
    await api.deleteAlbum(id)
    await refresh()
  }

  const move = async (index: number, delta: number) => {
    const ids = photos.map((p) => p.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + delta, 0, id!)
    await api.reorderPhotos(ids)
    await refresh()
  }

  return (
    <div className="sheet scroll-area pad-top starfield fixed inset-0 z-30 px-4 pb-[calc(var(--safe-bottom)+24px)] text-ink">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-semibold">{t.myGallery}</h2>
          {me && (
            <p className="text-xs text-hint">
              {me.photoCount} / {me.photoLimit} {t.photos}
            </p>
          )}
        </div>
        <button onClick={() => setSheet(null)} aria-label={t.close} className="flex size-11 items-center justify-center">
          <CloseIcon />
        </button>
      </header>

      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          void upload([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      <button onClick={() => file.current?.click()} className="mt-3 min-h-12 w-full rounded-xl bg-accent font-bold text-on-accent">
        {t.upload}
      </button>
      {progress && <p className="mt-2 text-sm text-hint" role="status">{progress}</p>}
      <p className="mt-2 text-xs leading-relaxed text-hint">{t.botHint}</p>

      <h3 className="mt-7 mb-2 text-sm font-bold text-hint">{t.albums}</h3>
      <div className="flex gap-2">
        <input value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} maxLength={80} placeholder={t.newAlbum} aria-label={t.newAlbum} className={field} />
        <button onClick={() => void addAlbum()} className={`${smallButton} shrink-0 bg-bg`}>{t.addAlbum}</button>
      </div>
      <ul className="mt-2">
        {albums.map((album) => (
          <li key={album.id} className="flex items-center gap-2 border-b border-hint/15 py-1">
            <input
              key={album.title}
              defaultValue={album.title}
              aria-label={t.rename}
              maxLength={80}
              onBlur={(e) => e.target.value !== album.title && void renameAlbum(album.id, e.target.value)}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none focus:underline"
            />
            <span className="shrink-0 text-xs text-hint">{album.photoCount}</span>
            <button onClick={() => void removeAlbum(album.id)} className={`${smallButton} shrink-0 text-danger`}>{t.remove}</button>
          </li>
        ))}
      </ul>

      <h3 className="mt-7 mb-1 text-sm font-bold text-hint">{t.all}</h3>
      <ul>
        {photos.map((photo, index) => (
          <PhotoRow
            key={photo.id}
            photo={photo}
            canMoveUp={index > 0}
            canMoveDown={index < photos.length - 1}
            onMove={(delta) => void move(index, delta)}
          />
        ))}
      </ul>
    </div>
  )
}
