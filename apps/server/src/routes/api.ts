import {
  albumInputSchema,
  albumQuerySchema,
  albumReorderSchema,
  photoPatchSchema,
  photoQuerySchema,
  reorderSchema,
  shareTokenSchema,
  type Me,
  type PhotoPage,
  type Share,
  type SharedGallery,
} from '@gallery/shared'
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth'
import type { Db } from '../db'
import { albums, favorites, photos, shares } from '../db/schema'
import { env } from '../env'
import { UnsupportedImageError } from '../lib/image'
import { addPhoto, deletePhoto, listAlbums, ownsAlbum, QuotaExceededError, toPhoto } from '../lib/photos'
import { findShare, getOrCreateShare, revokeShare } from '../lib/shares'

const idParams = z.object({ id: z.uuid() })

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

const tokenParams = z.object({ token: shareTokenSchema })

/**
 * Every gallery is private to its Telegram user. Others see it only through the owner's share
 * link (read-only), or one photo at a time through a shared photo link.
 */
export async function apiRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.addHook('preHandler', requireUser)

  const sharedOwner = async (token: string) => {
    const [row] = await db.select({ ownerId: shares.ownerId }).from(shares).where(eq(shares.token, token))
    return row?.ownerId ?? null
  }

  app.get('/me', async ({ tgUser }): Promise<Me> => {
    const [rows, owned] = await Promise.all([
      db.select({ photoId: favorites.photoId }).from(favorites).where(eq(favorites.userId, tgUser.id)),
      db.select({ total: count() }).from(photos).where(eq(photos.ownerId, tgUser.id)),
    ])
    return {
      id: tgUser.id,
      firstName: tgUser.first_name,
      languageCode: tgUser.language_code ?? null,
      favoriteIds: rows.map((r) => r.photoId),
      photoCount: owned[0]?.total ?? 0,
      photoLimit: env.MAX_PHOTOS_PER_USER,
    }
  })

  app.get('/albums', async (request, reply) => {
    const { gallery } = albumQuerySchema.parse(request.query)
    const owner = gallery ? await sharedOwner(gallery) : request.tgUser.id
    return owner === null ? reply.code(404).send({ error: 'not_found' }) : listAlbums(db, owner)
  })

  app.get('/galleries/:token', async (request, reply): Promise<SharedGallery | undefined> => {
    const { token } = tokenParams.parse(request.params)
    const [row] = await db
      .select({ ownerName: shares.ownerName, photoCount: count(photos.id) })
      .from(shares)
      .leftJoin(photos, eq(photos.ownerId, shares.ownerId))
      .where(eq(shares.token, token))
      .groupBy(shares.ownerId)
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.get('/share', async (request): Promise<Share> => ({ token: await findShare(db, request.tgUser.id) }))

  // Creating a link is idempotent, so sharing twice sends the same link; revoking makes a new one next time.
  app.post('/share', async (request): Promise<Share> => ({
    token: await getOrCreateShare(db, request.tgUser.id, request.tgUser.first_name),
  }))

  app.delete('/share', async (request, reply) => {
    await revokeShare(db, request.tgUser.id)
    return reply.code(204).send()
  })

  app.get('/photos', async (request, reply): Promise<PhotoPage | undefined> => {
    const query = photoQuerySchema.parse(request.query)
    const viewer = request.tgUser.id
    const owner = query.gallery ? await sharedOwner(query.gallery) : viewer
    if (owner === null) return reply.code(404).send({ error: 'not_found' })
    // Favourites may include photos other people shared; everything else is one gallery.
    const filters: (SQL | undefined)[] = [
      query.favorites && !query.gallery
        ? inArray(photos.id, db.select({ id: favorites.photoId }).from(favorites).where(eq(favorites.userId, viewer)))
        : eq(photos.ownerId, owner),
    ]
    if (query.album) filters.push(eq(photos.albumId, query.album))
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`
      filters.push(or(ilike(photos.title, pattern), ilike(photos.description, pattern), ilike(photos.credit, pattern)))
    }
    const where = and(...filters)
    const [rows, totals] = await Promise.all([
      db
        .select()
        .from(photos)
        .where(where)
        .orderBy(asc(photos.position), desc(photos.createdAt))
        .limit(query.limit)
        .offset(query.cursor),
      db.select({ total: count() }).from(photos).where(where),
    ])
    const total = totals[0]?.total ?? 0
    const end = query.cursor + rows.length
    return { items: rows.map(toPhoto), total, nextCursor: end < total ? String(end) : null }
  })

  app.get('/photos/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const [row] = await db.select().from(photos).where(eq(photos.id, id))
    return row ? toPhoto(row) : reply.code(404).send({ error: 'not_found' })
  })

  app.put('/photos/:id/favorite', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    await db.insert(favorites).values({ userId: request.tgUser.id, photoId: id }).onConflictDoNothing()
    return reply.code(204).send()
  })

  app.delete('/photos/:id/favorite', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    await db.delete(favorites).where(and(eq(favorites.userId, request.tgUser.id), eq(favorites.photoId, id)))
    return reply.code(204).send()
  })

  // Managing a gallery: every route below only ever touches the caller's own rows.
  app.post('/admin/photos', async (request, reply) => {
    const owner = request.tgUser.id
    const file = await request.file()
    if (!file) return reply.code(400).send({ error: 'file_required' })
    const body = await file.toBuffer()
    const albumId = z.uuid().safeParse((file.fields.albumId as { value?: unknown } | undefined)?.value)
    const album = albumId.success && (await ownsAlbum(db, owner, albumId.data)) ? albumId.data : null
    try {
      const row = await addPhoto(db, body, { ownerId: owner, albumId: album, createdBy: owner })
      return reply.code(201).send(toPhoto(row))
    } catch (error) {
      if (error instanceof UnsupportedImageError) return reply.code(415).send({ error: 'unsupported_image' })
      if (error instanceof QuotaExceededError) return reply.code(409).send({ error: 'quota_exceeded' })
      throw error
    }
  })

  app.patch('/admin/photos/:id', async (request, reply) => {
    const owner = request.tgUser.id
    const { id } = idParams.parse(request.params)
    const patch = photoPatchSchema.parse(request.body)
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'empty_patch' })
    if (patch.albumId && !(await ownsAlbum(db, owner, patch.albumId))) return reply.code(404).send({ error: 'not_found' })
    const [row] = await db
      .update(photos)
      .set(patch)
      .where(and(eq(photos.id, id), eq(photos.ownerId, owner)))
      .returning()
    return row ? toPhoto(row) : reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/admin/photos/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const deleted = await deletePhoto(db, request.tgUser.id, id)
    return reply.code(deleted ? 204 : 404).send()
  })

  app.post('/admin/photos/reorder', async (request, reply) => {
    const { ids } = reorderSchema.parse(request.body)
    const owner = request.tgUser.id
    await db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.update(photos).set({ position }).where(and(eq(photos.id, id), eq(photos.ownerId, owner)))
      }
    })
    return reply.code(204).send()
  })

  app.post('/admin/albums', async (request, reply) => {
    const owner = request.tgUser.id
    const { title } = albumInputSchema.parse(request.body)
    const [row] = await db
      .insert(albums)
      .values({
        ownerId: owner,
        title,
        position: sql`(select coalesce(max(${albums.position}), 0) + 1 from ${albums} where ${albums.ownerId} = ${owner})`,
      })
      .returning()
    return reply.code(201).send(row)
  })

  app.post('/admin/albums/reorder', async (request, reply) => {
    const { ids } = albumReorderSchema.parse(request.body)
    const owner = request.tgUser.id
    await db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx.update(albums).set({ position }).where(and(eq(albums.id, id), eq(albums.ownerId, owner)))
      }
    })
    return reply.code(204).send()
  })

  app.patch('/admin/albums/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const { title } = albumInputSchema.parse(request.body)
    const [row] = await db
      .update(albums)
      .set({ title })
      .where(and(eq(albums.id, id), eq(albums.ownerId, request.tgUser.id)))
      .returning()
    return row ?? reply.code(404).send({ error: 'not_found' })
  })

  app.delete('/admin/albums/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    await db.delete(albums).where(and(eq(albums.id, id), eq(albums.ownerId, request.tgUser.id)))
    return reply.code(204).send()
  })
}
