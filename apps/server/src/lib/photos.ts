import { randomUUID } from 'node:crypto'
import type { Album, Photo } from '@gallery/shared'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { albums, photos } from '../db/schema'
import { env } from '../env'
import { processImage } from './image'
import { storage } from './storage'

export type PhotoRow = typeof photos.$inferSelect

export const mediaBase = (id: string) => `${env.MEDIA_BASE_URL}/photos/${id}`

export const toPhoto = (row: PhotoRow): Photo => ({
  id: row.id,
  albumId: row.albumId,
  title: row.title,
  description: row.description,
  credit: row.credit,
  width: row.width,
  height: row.height,
  blurhash: row.blurhash,
  base: mediaBase(row.id),
  createdAt: row.createdAt.toISOString(),
})

export class QuotaExceededError extends Error {
  constructor(readonly limit: number) {
    super(`gallery holds at most ${limit} photos`)
  }
}

export interface NewPhoto {
  ownerId: number
  albumId?: string | null
  title?: string
  description?: string
  credit?: string | null
  telegramFileUniqueId?: string
  createdBy?: number
}

/** Runs the full pipeline: validate, derive sizes, upload, then record the row last. */
export async function addPhoto(db: Db, input: Buffer, meta: NewPhoto): Promise<PhotoRow> {
  const [owned] = await db.select({ total: count() }).from(photos).where(eq(photos.ownerId, meta.ownerId))
  if ((owned?.total ?? 0) >= env.MAX_PHOTOS_PER_USER) throw new QuotaExceededError(env.MAX_PHOTOS_PER_USER)
  const image = await processImage(input)
  const id = randomUUID()
  await Promise.all(image.files.map((f) => storage.put(`photos/${id}/${f.name}`, f.body, f.contentType)))

  try {
    const [row] = await db
      .insert(photos)
      .values({
        id,
        ...meta,
        width: image.width,
        height: image.height,
        blurhash: image.blurhash,
        position: sql`(select coalesce(min(${photos.position}), 0) - 1 from ${photos} where ${photos.ownerId} = ${meta.ownerId})`,
      })
      .returning()
    return row!
  } catch (error) {
    await storage.removePrefix(`photos/${id}/`)
    throw error
  }
}

/** True when the album exists and belongs to this owner, so photos cannot be filed into someone else's. */
export async function ownsAlbum(db: Db, ownerId: number, albumId: string) {
  const [row] = await db.select({ id: albums.id }).from(albums).where(and(eq(albums.id, albumId), eq(albums.ownerId, ownerId)))
  return !!row
}

export async function ownedPhoto(db: Db, ownerId: number, photoId: string) {
  const [row] = await db.select().from(photos).where(and(eq(photos.id, photoId), eq(photos.ownerId, ownerId)))
  return row ?? null
}

/** Removes the row first, so a photo is never listed after its files are gone. */
export async function deletePhoto(db: Db, ownerId: number, photoId: string) {
  const [row] = await db
    .delete(photos)
    .where(and(eq(photos.id, photoId), eq(photos.ownerId, ownerId)))
    .returning({ id: photos.id })
  if (row) await storage.removePrefix(`photos/${photoId}/`)
  return !!row
}

/** Files a photo into one of the owner's albums, or into none with a null album. */
export async function setPhotoAlbum(db: Db, ownerId: number, photoId: string, albumId: string | null) {
  if (albumId && !(await ownsAlbum(db, ownerId, albumId))) return null
  const [row] = await db
    .update(photos)
    .set({ albumId })
    .where(and(eq(photos.id, photoId), eq(photos.ownerId, ownerId)))
    .returning()
  return row ?? null
}

/** Gives galleries made before they were personal to one user. */
export async function claimUnowned(db: Db, ownerId: number) {
  await db.update(albums).set({ ownerId }).where(isNull(albums.ownerId))
  await db.update(photos).set({ ownerId }).where(isNull(photos.ownerId))
}

export async function listAlbums(db: Db, ownerId: number): Promise<Album[]> {
  const rows = await db
    .select({
      id: albums.id,
      title: albums.title,
      position: albums.position,
      photoCount: sql<number>`count(${photos.id})::int`,
      coverId: sql<string | null>`(array_agg(${photos.id} order by ${photos.position}))[1]`,
    })
    .from(albums)
    .leftJoin(photos, sql`${photos.albumId} = ${albums.id}`)
    .where(eq(albums.ownerId, ownerId))
    .groupBy(albums.id)
    .orderBy(albums.position, albums.createdAt)
  return rows.map(({ coverId, ...album }) => ({
    ...album,
    coverUrl: coverId ? `${mediaBase(coverId)}/400.webp` : null,
  }))
}
