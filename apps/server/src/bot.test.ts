import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Bot } from 'grammy'
import type { Update } from 'grammy/types'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ALICE = { id: 7, is_bot: false, first_name: 'Alice', language_code: 'en' }
const BOB = { id: 8, is_bot: false, first_name: 'Bob', language_code: 'ru' }
const APP = 'https://t.me/test_bot/app'

interface Call {
  method: string
  payload: Record<string, unknown>
}

let bot: Bot
let db: Awaited<ReturnType<typeof import('./db').createDb>>
let schema: typeof import('./db/schema')
let configureBot: typeof import('./bot').configureBot
let calls: Call[] = []
let updateId = 0
let messageId = 100

const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#4af' } }).png().toBuffer()

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-bot-'))
  vi.stubEnv('BOT_TOKEN', '1:x')
  vi.stubEnv('PGLITE_DIR', join(dir, 'db'))
  vi.stubEnv('STORAGE_DIR', join(dir, 'media'))
  vi.stubEnv('MEDIA_BASE_URL', 'https://media.test')
  vi.stubEnv('MINI_APP_URL', 'https://app.test')
  vi.stubEnv('VITE_TG_APP_LINK', APP)
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
    String(input).startsWith('https://api.telegram.org/file/') ? Promise.resolve(new Response(png)) : real(input, init),
  )
  const { createDb } = await import('./db')
  const botModule = await import('./bot')
  schema = await import('./db/schema')
  configureBot = botModule.configureBot
  db = await createDb()
  bot = botModule.createBot('1:x', db)
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: 'Test',
    username: 'test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: true,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  }
  // Every Bot API call is recorded and answered locally, so no request leaves the test.
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    const result =
      method === 'sendMessage'
        ? { message_id: ++messageId, date: 0, chat: { id: 1, type: 'private' }, text: '' }
        : method === 'getFile'
          ? { file_id: 'f', file_unique_id: 'u', file_path: 'photos/a.png' }
          : true
    return Promise.resolve({ ok: true, result } as never)
  })
}, 60_000)

afterAll(() => vi.restoreAllMocks())

beforeEach(() => {
  calls = []
})

const chat = (user: typeof ALICE, type: 'private' | 'group' = 'private') =>
  type === 'private' ? { id: user.id, type, first_name: user.first_name } : { id: -100, type, title: 'Group' }

const send = (update: Omit<Update, 'update_id'>) => bot.handleUpdate({ update_id: ++updateId, ...update } as Update)

const command = (user: typeof ALICE, text: string) =>
  send({
    message: {
      message_id: ++messageId,
      date: 0,
      chat: chat(user),
      from: user,
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }],
    },
  } as never)

let fileCounter = 0
const photo = (user: typeof ALICE, extra: Record<string, unknown> = {}, type: 'private' | 'group' = 'private') =>
  send({
    message: {
      message_id: ++messageId,
      date: 0,
      chat: chat(user, type),
      from: user,
      photo: [{ file_id: `f${++fileCounter}`, file_unique_id: `u${fileCounter}`, width: 80, height: 60, file_size: 1000 }],
      ...extra,
    },
  } as never)

const press = (user: typeof ALICE, data: string) =>
  send({
    callback_query: {
      id: String(++updateId),
      from: user,
      chat_instance: 'c',
      data,
      message: { message_id: 1, date: 0, chat: chat(user), text: 'x' },
    },
  } as never)

const sent = (method: string) => calls.filter((call) => call.method === method)
const buttons = (call: Call | undefined) =>
  ((call?.payload.reply_markup as { inline_keyboard?: { text: string; url?: string; callback_data?: string; switch_inline_query?: string }[][] })
    ?.inline_keyboard ?? []).flat()

async function alicePhoto(caption?: string) {
  await photo(ALICE, caption ? { caption } : {})
  const reply = sent('sendMessage').at(-1)
  const view = buttons(reply).find((b) => b.url?.includes('startapp=photo_'))!
  return { reply, id: view.url!.split('photo_')[1]!, packed: buttons(reply).find((b) => b.callback_data?.startsWith('rm:'))!.callback_data!.slice(3) }
}

describe('commands', () => {
  it('greets in the sender’s language, sets their menu button and links straight into the app', async () => {
    await command(BOB, '/start')
    expect(sent('setChatMenuButton')[0]!.payload).toMatchObject({ chat_id: BOB.id, menu_button: { text: 'Галерея' } })
    const reply = sent('sendMessage')[0]!
    expect(reply.payload.text).toMatch(/Добро пожаловать/)
    expect(buttons(reply)[0]).toMatchObject({ url: APP })
  })

  it('explains itself, including inline mode with the bot’s own name', async () => {
    await command(ALICE, '/help')
    const reply = sent('sendMessage')[0]!
    expect(reply.payload.parse_mode).toBe('HTML')
    expect(reply.payload.text).toMatch(/@test_bot/)
  })

  it('publishes the command menu in all three languages', async () => {
    await configureBot(bot)
    const menus = sent('setMyCommands')
    expect(menus.map((m) => m.payload.language_code)).toEqual([undefined, 'ru', 'en'])
    expect((menus[0]!.payload.commands as { command: string }[]).map((c) => c.command)).toEqual(['gallery', 'share', 'stats', 'language', 'help'])
  })

  it('stays silent in group chats', async () => {
    await photo(ALICE, {}, 'group')
    await send({ message: { message_id: 1, date: 0, chat: chat(ALICE, 'group'), from: ALICE, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } } as never)
    expect(calls).toEqual([])
  })
})

describe('saving photos', () => {
  it('saves to the sender’s gallery and offers view, send, album and delete', async () => {
    const { reply, id } = await alicePhoto('Sunset <3\nat sea')
    expect(sent('sendChatAction')[0]!.payload.action).toBe('upload_photo')
    expect(reply!.payload.text).toBe('✅ “Sunset &lt;3” added to your gallery.')
    const kinds = buttons(reply).map((b) => b.url ?? b.switch_inline_query ?? b.callback_data!.slice(0, 3))
    expect(kinds).toEqual([`${APP}?startapp=photo_${id}`, expect.stringMatching(/^#/), 'al:', 'rm:'])
    const [row] = await db.select().from(schema.photos).where(eqId(id))
    expect(row).toMatchObject({ ownerId: ALICE.id, title: 'Sunset <3', description: 'at sea' })
  })

  it('refuses files Telegram will not hand over', async () => {
    await send({
      message: { message_id: 1, date: 0, chat: chat(ALICE), from: ALICE, document: { file_id: 'big', file_unique_id: 'big', mime_type: 'image/png', file_size: 30 * 1024 * 1024 } },
    } as never)
    expect(sent('sendMessage')[0]!.payload.text).toMatch(/20 MB/)
  })

  it('collects a media group into one album with a progress message', async () => {
    await photo(ALICE, { media_group_id: 'g1', caption: 'Trip' })
    await photo(ALICE, { media_group_id: 'g1' })
    await new Promise((resolve) => setTimeout(resolve, 3500))
    expect(sent('sendMessage')[0]!.payload.text).toMatch(/Saving 2 photos/)
    expect(sent('editMessageText')[0]!.payload.text).toBe('✅ Added 2 photos to “Trip”.')
    const trip = await db.select().from(schema.albums).where(eqTitle('Trip'))
    expect(trip).toHaveLength(1)
  }, 15_000)
})

describe('photo buttons', () => {
  it('files a photo into an album and back out', async () => {
    const { packed, id } = await alicePhoto()
    calls = []
    await press(ALICE, `al:${packed}`)
    const choice = buttons(sent('editMessageReplyMarkup')[0])
    const trip = choice.find((b) => b.text.endsWith('Trip'))!
    await press(ALICE, trip.callback_data!)
    expect(sent('editMessageText').at(-1)!.payload.text).toBe('📁 Moved to “Trip”.')
    expect((await db.select().from(schema.photos).where(eqId(id)))[0]!.albumId).not.toBeNull()
    await press(ALICE, `mv:${packed}:-`)
    expect((await db.select().from(schema.photos).where(eqId(id)))[0]!.albumId).toBeNull()
  })

  it('asks before deleting, then deletes', async () => {
    const { packed, id } = await alicePhoto()
    calls = []
    await press(ALICE, `rm:${packed}`)
    expect(buttons(sent('editMessageReplyMarkup')[0]).map((b) => b.callback_data)).toEqual([`rmy:${packed}`, `bk:${packed}`])
    await press(ALICE, `rmy:${packed}`)
    expect(sent('editMessageText')[0]!.payload.text).toBe('🗑 Photo deleted.')
    expect(await db.select().from(schema.photos).where(eqId(id))).toEqual([])
  })

  it('will not let anyone else touch the photo, even with its buttons', async () => {
    const { packed, id } = await alicePhoto()
    calls = []
    await press(BOB, `rmy:${packed}`)
    await press(BOB, `mv:${packed}:-`)
    expect(sent('answerCallbackQuery').every((call) => call.payload.show_alert === true)).toBe(true)
    expect(await db.select().from(schema.photos).where(eqId(id))).toHaveLength(1)
  })
})

describe('sharing and stats', () => {
  it('hands out one stable gallery link and revokes it on request', async () => {
    await command(ALICE, '/share')
    const first = String(sent('sendMessage')[0]!.payload.text).match(/startapp=g_([\w-]+)/)![1]
    expect(buttons(sent('sendMessage')[0]).map((b) => b.url ?? b.callback_data)).toEqual([expect.stringMatching(/^https:\/\/t\.me\/share\/url/), 'rv'])
    await command(ALICE, '/share')
    expect(String(sent('sendMessage')[1]!.payload.text)).toContain(`g_${first}`)
    await press(ALICE, 'rv')
    expect(await db.select().from(schema.shares)).toEqual([])
  })

  it('reports the gallery at a glance', async () => {
    await command(ALICE, '/stats')
    expect(sent('sendMessage')[0]!.payload.text).toMatch(/Photos: \d+ \/ 300\nAlbums: 1\nShare link: off/)
  })
})

describe('inline mode', () => {
  it('lists only the sender’s own photos, as JPEG', async () => {
    await send({ inline_query: { id: 'q1', from: ALICE, query: '', offset: '' } } as never)
    const results = sent('answerInlineQuery')[0]!.payload.results as { photo_url: string }[]
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => /^https:\/\/media\.test\/photos\/[\w-]+\/full\.jpg$/.test(r.photo_url))).toBe(true)

    await send({ inline_query: { id: 'q2', from: BOB, query: '', offset: '' } } as never)
    const empty = sent('answerInlineQuery')[1]!.payload
    expect(empty.results).toEqual([])
    expect(empty.button).toMatchObject({ start_parameter: 'inline' })
  })

  it('finds one photo exactly from its send button', async () => {
    const { reply, id } = await alicePhoto('Exact one')
    const query = buttons(reply).find((b) => b.switch_inline_query)!.switch_inline_query!
    calls = []
    await send({ inline_query: { id: 'q3', from: ALICE, query, offset: '' } } as never)
    expect((sent('answerInlineQuery')[0]!.payload.results as { id: string }[]).map((r) => r.id)).toEqual([id])
  })
})

const eqId = (id: string) => eq(schema.photos.id, id)
const eqTitle = (title: string) => eq(schema.albums.title, title)

describe('language choice', () => {
  it('offers the three languages on /start and /language', async () => {
    await command(ALICE, '/language')
    expect(buttons(sent('sendMessage')[0]).map((b) => b.callback_data)).toEqual(['lang:uz', 'lang:ru', 'lang:en'])
    await command(ALICE, '/start')
    expect(buttons(sent('sendMessage')[1]).map((b) => b.callback_data).filter(Boolean)).toEqual(['up', 'lang:uz', 'lang:ru', 'lang:en'])
  })

  it('remembers the choice over Telegram’s language and renames this chat’s menus', async () => {
    await press(ALICE, 'lang:ru')
    expect(sent('editMessageText')[0]!.payload.text).toMatch(/Язык изменён/)
    // Right after choosing, the next steps are one tap away: open the gallery or upload.
    expect(buttons(sent('editMessageText')[0]).map((b) => b.url ?? b.callback_data)).toEqual([APP, 'up'])
    expect(buttons(sent('editMessageText')[0])[1]!.text).toBe('📷 Загрузить фото')
    const scoped = sent('setMyCommands').find((call) => (call.payload.scope as { type?: string })?.type === 'chat')!
    expect(scoped.payload.scope).toEqual({ type: 'chat', chat_id: ALICE.id })
    expect((scoped.payload.commands as { description: string }[])[0]!.description).toBe('Открыть галерею')
    expect(sent('setChatMenuButton')[0]!.payload).toMatchObject({ menu_button: { text: 'Галерея' } })
    calls = []
    await command(ALICE, '/stats')
    expect(sent('sendMessage')[0]!.payload.text).toMatch(/Ваша галерея/)
    await press(ALICE, 'lang:en')
  })
})

describe('upload button', () => {
  it('explains how to send photos and opens the app at its upload sheet', async () => {
    await press(ALICE, 'up')
    const reply = sent('sendMessage')[0]!
    expect(reply.payload.text).toMatch(/📎/)
    expect(buttons(reply)).toEqual([expect.objectContaining({ url: `${APP}?startapp=upload` })])
    expect(sent('answerCallbackQuery')).toHaveLength(1)
  })
})

describe('sharing a finished album', () => {
  it('offers to share the album as soon as it is saved, with a link that opens at it', async () => {
    await photo(ALICE, { media_group_id: 'g2', caption: 'Holiday' })
    await photo(ALICE, { media_group_id: 'g2' })
    await new Promise((resolve) => setTimeout(resolve, 3500))
    const shareButton = buttons(sent('editMessageText').at(-1)).find((b) => b.callback_data?.startsWith('sa:'))!
    expect(shareButton.text).toBe('🔗 Share album')
    calls = []
    await press(ALICE, shareButton.callback_data!)
    const reply = sent('sendMessage')[0]!
    expect(reply.payload.text).toMatch(/“Holiday” album/)
    const param = String(reply.payload.text).match(/startapp=(g_[\w-]+)/)![1]!
    const { parseGalleryStart } = await import('@gallery/shared')
    const parsed = parseGalleryStart(param)!
    const [holiday] = await db.select().from(schema.albums).where(eqTitle('Holiday'))
    expect(parsed.albumId).toBe(holiday!.id)
  }, 15_000)

  it('will not share someone else’s album', async () => {
    const [holiday] = await db.select().from(schema.albums).where(eqTitle('Holiday'))
    const { packId } = await import('@gallery/shared')
    await press(BOB, `sa:${packId(holiday!.id)}`)
    expect(sent('answerCallbackQuery')[0]!.payload.show_alert).toBe(true)
    expect(sent('sendMessage')).toEqual([])
  })
})
