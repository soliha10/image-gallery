import {
  albumInputSchema,
  albumReorderSchema,
  photoPatchSchema,
  photoQuerySchema,
  reorderSchema,
  type Me,
  type PhotoPage,
} from '@gallery/shared'
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isAdmin, requireAdmin, requireUser } from '../auth'
import type { Db } from '../db'
import { albums, favorites, photos } from '../db/schema'
import { UnsupportedImageError } from '../lib/image'
import { addPhoto, listAlbums, toPhoto } from '../lib/photos'
import { storage } from '../lib/storage'

const idParams = z.object({ id: z.uuid() })

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

export async function apiRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.addHook('preHandler', requireUser)

  app.get('/me', async ({ tgUser }): Promise<Me> => {
    const rows = await db
      .select({ photoId: favorites.photoId })
      .from(favorites)
      .where(eq(favorites.userId, tgUser.id))
    return {
      id: tgUser.id,
      firstName: tgUser.first_name,
      languageCode: tgUser.language_code ?? null,
      isAdmin: isAdmin(tgUser.id),
      favoriteIds: rows.map((r) => r.photoId),
    }
  })

  app.get('/albums', () => listAlbums(db))

  app.get('/photos', async (request): Promise<PhotoPage> => {
    const query = photoQuerySchema.parse(request.query)
    const filters: (SQL | undefined)[] = []
    if (query.album) filters.push(eq(photos.albumId, query.album))
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`
      filters.push(or(ilike(photos.title, pattern), ilike(photos.description, pattern), ilike(photos.credit, pattern)))
    }
    if (query.favorites) {
      filters.push(
        inArray(
          photos.id,
          db.select({ id: favorites.photoId }).from(favorites).where(eq(favorites.userId, request.tgUser.id)),
        ),
      )
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

  await app.register(async (admin) => {
    admin.addHook('preHandler', requireAdmin)

    admin.post('/admin/photos', async (request, reply) => {
      const file = await request.file()
      if (!file) return reply.code(400).send({ error: 'file_required' })
      const body = await file.toBuffer()
      const albumId = z.uuid().safeParse((file.fields.albumId as { value?: unknown } | undefined)?.value)
      try {
        const row = await addPhoto(db, body, {
          albumId: albumId.success ? albumId.data : null,
          createdBy: request.tgUser.id,
        })
        return reply.code(201).send(toPhoto(row))
      } catch (error) {
        if (error instanceof UnsupportedImageError) return reply.code(415).send({ error: 'unsupported_image' })
        throw error
      }
    })

    admin.patch('/admin/photos/:id', async (request, reply) => {
      const { id } = idParams.parse(request.params)
      const patch = photoPatchSchema.parse(request.body)
      if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'empty_patch' })
      const [row] = await db.update(photos).set(patch).where(eq(photos.id, id)).returning()
      return row ? toPhoto(row) : reply.code(404).send({ error: 'not_found' })
    })

    admin.delete('/admin/photos/:id', async (request, reply) => {
      const { id } = idParams.parse(request.params)
      const [row] = await db.delete(photos).where(eq(photos.id, id)).returning({ id: photos.id })
      if (!row) return reply.code(404).send({ error: 'not_found' })
      await storage.removePrefix(`photos/${id}/`)
      return reply.code(204).send()
    })

    admin.post('/admin/photos/reorder', async (request, reply) => {
      const { ids } = reorderSchema.parse(request.body)
      await db.transaction(async (tx) => {
        for (const [position, id] of ids.entries()) {
          await tx.update(photos).set({ position }).where(eq(photos.id, id))
        }
      })
      return reply.code(204).send()
    })

    admin.post('/admin/albums', async (request, reply) => {
      const { title } = albumInputSchema.parse(request.body)
      const [row] = await db
        .insert(albums)
        .values({ title, position: sql`(select coalesce(max(position), 0) + 1 from albums)` })
        .returning()
      return reply.code(201).send(row)
    })

    admin.post('/admin/albums/reorder', async (request, reply) => {
      const { ids } = albumReorderSchema.parse(request.body)
      await db.transaction(async (tx) => {
        for (const [position, id] of ids.entries()) {
          await tx.update(albums).set({ position }).where(eq(albums.id, id))
        }
      })
      return reply.code(204).send()
    })

    admin.patch('/admin/albums/:id', async (request, reply) => {
      const { id } = idParams.parse(request.params)
      const { title } = albumInputSchema.parse(request.body)
      const [row] = await db.update(albums).set({ title }).where(eq(albums.id, id)).returning()
      return row ?? reply.code(404).send({ error: 'not_found' })
    })

    admin.delete('/admin/albums/:id', async (request, reply) => {
      const { id } = idParams.parse(request.params)
      await db.delete(albums).where(eq(albums.id, id))
      return reply.code(204).send()
    })
  })
}
