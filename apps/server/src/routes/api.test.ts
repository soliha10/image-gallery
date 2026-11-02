import { createHmac } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const TOKEN = '123:abc'
const ADMIN = 7
const USER = 8

function initData(id: number) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'T' }) }
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  const hash = createHmac('sha256', secret).update(check).digest('hex')
  return `tma ${new URLSearchParams({ ...fields, hash })}`
}

let app: FastifyInstance

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
  vi.stubEnv('BOT_TOKEN', TOKEN)
  vi.stubEnv('ADMIN_IDS', String(ADMIN))
  vi.stubEnv('PGLITE_DIR', join(dir, 'db'))
  vi.stubEnv('STORAGE_DIR', join(dir, 'media'))
  const { createDb } = await import('../db')
  const { buildApp } = await import('../app')
  app = await buildApp(await createDb(), null)
})

afterAll(() => app.close())

describe('permissions', () => {
  it('rejects requests without valid initData', async () => {
    expect((await app.inject({ url: '/api/photos' })).statusCode).toBe(401)
    const bad = await app.inject({ url: '/api/photos', headers: { authorization: 'tma hash=00' } })
    expect(bad.statusCode).toBe(401)
  })

  it('lets a user read but not write', async () => {
    const headers = { authorization: initData(USER) }
    expect((await app.inject({ url: '/api/photos', headers })).statusCode).toBe(200)
    const denied = await app.inject({ method: 'POST', url: '/api/admin/albums', headers, payload: { title: 'x' } })
    expect(denied.statusCode).toBe(403)
  })

  it('lets an admin write and reports the role', async () => {
    const headers = { authorization: initData(ADMIN) }
    const created = await app.inject({ method: 'POST', url: '/api/admin/albums', headers, payload: { title: 'Albom' } })
    expect(created.statusCode).toBe(201)
    expect((await app.inject({ url: '/api/me', headers })).json().isAdmin).toBe(true)
  })

  it('returns 400 for invalid input', async () => {
    const headers = { authorization: initData(USER) }
    expect((await app.inject({ url: '/api/photos?limit=9999', headers })).statusCode).toBe(400)
  })
})
