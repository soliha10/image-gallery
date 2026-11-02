import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const TOKEN = '123:abc'
const ALICE = 7
const BOB = 8

function initData(id: number) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) }
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  const hash = createHmac('sha256', secret).update(check).digest('hex')
  return `tma ${new URLSearchParams({ ...fields, hash })}`
}

const as = (id: number) => ({ authorization: initData(id) })

async function upload(user: number, albumId?: string) {
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#fa0' } }).png().toBuffer()
  const boundary = 'x-boundary'
  const parts = [
    ...(albumId ? [`--${boundary}\r\nContent-Disposition: form-data; name="albumId"\r\n\r\n${albumId}\r\n`] : []),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
  ]
  const payload = Buffer.concat([Buffer.from(parts.join('')), png, Buffer.from(`\r\n--${boundary}--\r\n`)])
  return app.inject({
    method: 'POST',
    url: '/api/admin/photos',
    headers: { ...as(user), 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  })
}

let app: FastifyInstance

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
  vi.stubEnv('BOT_TOKEN', TOKEN)
  vi.stubEnv('MAX_PHOTOS_PER_USER', '3')
  vi.stubEnv('PGLITE_DIR', join(dir, 'db'))
  vi.stubEnv('STORAGE_DIR', join(dir, 'media'))
  const { createDb } = await import('../db')
  const { buildApp } = await import('../app')
  app = await buildApp(await createDb(), null)
}, 60_000)

afterAll(() => app.close())

describe('access', () => {
  it('rejects requests without valid initData', async () => {
    expect((await app.inject({ url: '/api/photos' })).statusCode).toBe(401)
    const bad = await app.inject({ url: '/api/photos', headers: { authorization: 'tma hash=00' } })
    expect(bad.statusCode).toBe(401)
  })

  it('returns 400 for invalid input', async () => {
    expect((await app.inject({ url: '/api/photos?limit=9999', headers: as(BOB) })).statusCode).toBe(400)
  })
})

describe('personal galleries', () => {
  let album: string
  let photo: string

  it('lets every user build their own gallery', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/admin/albums', headers: as(ALICE), payload: { title: 'Alice' } })
    expect(created.statusCode).toBe(201)
    album = created.json().id
    const uploaded = await upload(ALICE, album)
    expect(uploaded.statusCode).toBe(201)
    photo = uploaded.json().id
    expect(uploaded.json().albumId).toBe(album)

    const mine = await app.inject({ url: '/api/photos', headers: as(ALICE) })
    expect(mine.json().items.map((p: { id: string }) => p.id)).toEqual([photo])
    expect((await app.inject({ url: '/api/albums', headers: as(ALICE) })).json()).toHaveLength(1)
    expect((await app.inject({ url: '/api/me', headers: as(ALICE) })).json()).toMatchObject({ photoCount: 1, photoLimit: 3 })
  })

  it('keeps one gallery out of another', async () => {
    expect((await app.inject({ url: '/api/photos', headers: as(BOB) })).json().total).toBe(0)
    expect((await app.inject({ url: '/api/albums', headers: as(BOB) })).json()).toEqual([])
    const search = await app.inject({ url: '/api/photos?q=', headers: as(BOB) })
    expect(search.json().total).toBe(0)
  })

  it('refuses to change, move or delete someone else’s photos and albums', async () => {
    const headers = as(BOB)
    const patch = await app.inject({ method: 'PATCH', url: `/api/admin/photos/${photo}`, headers, payload: { title: 'mine now' } })
    expect(patch.statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/photos/${photo}`, headers })).statusCode).toBe(404)
    await app.inject({ method: 'PATCH', url: `/api/admin/albums/${album}`, headers, payload: { title: 'taken' } })
    await app.inject({ method: 'DELETE', url: `/api/admin/albums/${album}`, headers })
    await app.inject({ method: 'POST', url: '/api/admin/photos/reorder', headers, payload: { ids: [photo] } })

    const alice = await app.inject({ url: '/api/albums', headers: as(ALICE) })
    expect(alice.json()[0].title).toBe('Alice')
    const kept = await app.inject({ url: `/api/photos/${photo}`, headers: as(ALICE) })
    expect(kept.json().title).toBe('')
  })

  it('does not file uploads into someone else’s album', async () => {
    const uploaded = await upload(BOB, album)
    expect(uploaded.statusCode).toBe(201)
    expect(uploaded.json().albumId).toBeNull()
    const own = await app.inject({ method: 'PATCH', url: `/api/admin/photos/${uploaded.json().id}`, headers: as(BOB), payload: { albumId: album } })
    expect(own.statusCode).toBe(404)
  })

  it('opens a shared photo for anyone with the link, and lets them keep it as a favourite', async () => {
    const shared = await app.inject({ url: `/api/photos/${photo}`, headers: as(BOB) })
    expect(shared.statusCode).toBe(200)
    await app.inject({ method: 'PUT', url: `/api/photos/${photo}/favorite`, headers: as(BOB) })
    const favourites = await app.inject({ url: '/api/photos?favorites=1', headers: as(BOB) })
    expect(favourites.json().items.map((p: { id: string }) => p.id)).toEqual([photo])
  })

  it('stops uploads at the per-user limit without touching other users', async () => {
    expect((await upload(ALICE)).statusCode).toBe(201)
    expect((await upload(ALICE)).statusCode).toBe(201)
    const full = await upload(ALICE)
    expect(full.statusCode).toBe(409)
    expect(full.json().error).toBe('quota_exceeded')
    expect((await upload(BOB)).statusCode).toBe(201)
  })
})
