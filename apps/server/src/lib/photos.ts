import { randomUUID } from 'node:crypto'
import type { Album, Photo } from '@gallery/shared'
import { sql } from 'drizzle-orm'
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

export interface NewPhoto {
  albumId?: string | null
  title?: string
  description?: string
  credit?: string | null
  telegramFileUniqueId?: string
  createdBy?: number
}

/** Runs the full pipeline: validate, derive sizes, upload, then record the row last. */
export async function addPhoto(db: Db, input: Buffer, meta: NewPhoto): Promise<PhotoRow> {
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
        position: sql`(select coalesce(min(${photos.position}), 0) - 1 from ${photos})`,
      })
      .returning()
    return row!
  } catch (error) {
    await storage.removePrefix(`photos/${id}/`)
    throw error
  }
}

export async function listAlbums(db: Db): Promise<Album[]> {
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
    .groupBy(albums.id)
    .orderBy(albums.position, albums.createdAt)
  return rows.map(({ coverId, ...album }) => ({
    ...album,
    coverUrl: coverId ? `${mediaBase(coverId)}/400.webp` : null,
  }))
}
