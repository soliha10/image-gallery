import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { Bot } from 'grammy'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const SECRET = 'webhook-secret'

let app: FastifyInstance

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-'))
  vi.stubEnv('BOT_TOKEN', '123:abc')
  vi.stubEnv('PUBLIC_URL', 'https://example.com')
  vi.stubEnv('BOT_WEBHOOK_SECRET', SECRET)
  vi.stubEnv('PGLITE_DIR', join(dir, 'db'))
  vi.stubEnv('STORAGE_DIR', join(dir, 'media'))
  const { createDb } = await import('../db')
  const { buildApp } = await import('../app')
  const bot = new Bot('123:abc', {
    botInfo: {
      id: 123,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
  })
  app = await buildApp(await createDb(), bot)
})

afterAll(() => app.close())

const post = (secret?: string) =>
  app.inject({
    method: 'POST',
    url: '/telegram/webhook',
    headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
    payload: { update_id: 1 },
  })

describe('telegram webhook', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await post()).statusCode).toBe(401)
    expect((await post('nope')).statusCode).toBe(401)
  })
  it('accepts the configured secret', async () => {
    expect((await post(SECRET)).statusCode).toBe(200)
  })
})
