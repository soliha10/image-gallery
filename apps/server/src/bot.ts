import { autoRetry } from '@grammyjs/auto-retry'
import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { Bot, InlineKeyboard, type Api, type Context } from 'grammy'
import type { InlineQueryResultPhoto, Message } from 'grammy/types'
import { galleryStartParam, type Language } from '@gallery/shared'
import { BOT_LANGUAGES, botText, html, LANGUAGE_BUTTONS } from './botText'
import type { Db } from './db'
import { albums, photos } from './db/schema'
import { appLinkBase, env } from './env'
import { packId, unpackId } from './lib/compactId'
import { UnsupportedImageError } from './lib/image'
import { MediaGroupCollector } from './lib/mediaGroup'
import { addPhoto, deletePhoto, mediaBase, ownedPhoto, ownsAlbum, QuotaExceededError, setPhotoAlbum, type PhotoRow } from './lib/photos'
import { Semaphore } from './lib/semaphore'
import { resolveLanguage, saveLanguage } from './lib/settings'
import { findShare, getOrCreateShare, revokeShare } from './lib/shares'

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
/** Photos resized at the same time; the free server has 512 MB and one slow CPU. */
const PROCESSING_SLOTS = 2
const INLINE_PAGE = 20
const ALBUM_CHOICES = 8

interface IncomingFile {
  fileId: string
  fileUniqueId: string
  fileSize?: number
}

function imageFile(message: Message): IncomingFile | null {
  const largest = message.photo?.at(-1)
  if (largest) return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id, fileSize: largest.file_size }
  const doc = message.document
  if (doc?.mime_type?.startsWith('image/')) {
    return { fileId: doc.file_id, fileUniqueId: doc.file_unique_id, fileSize: doc.file_size }
  }
  return null
}

function splitCaption(caption = '') {
  const [first = '', ...rest] = caption.trim().split('\n')
  return { title: first.trim().slice(0, 120), description: rest.join('\n').trim().slice(0, 1000) }
}

/** Every update carries the sender's language: their saved choice, else Telegram's. */
export type BotContext = Context & { lang?: string }

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

/** Links straight into the Mini App, optionally at a start parameter. */
const appLink = (param?: string) => (appLinkBase ? (param ? `${appLinkBase}?startapp=${param}` : appLinkBase) : null)

export function createBot(token: string, db: Db) {
  const bot = new Bot<BotContext>(token)
  // Telegram answers bursts with 429 and a wait time; retrying keeps album replies from being lost.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }))
  bot.use(async (ctx, next) => {
    if (ctx.from) ctx.lang = await resolveLanguage(db, ctx.from)
    await next()
  })
  const processing = new Semaphore(PROCESSING_SLOTS)
  // Galleries are personal, so the bot only works in one-to-one chats; groups are ignored.
  const chat = bot.chatType('private')

  const download = async (fileId: string) => {
    // The file URL embeds the bot token, so it stays inside this function.
    const file = await bot.api.getFile(fileId)
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
    if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  // Each sender's photos land in their own gallery.
  const save = (message: Message, file: IncomingFile, albumId: string | null) =>
    processing.run(async () => {
      const owner = message.from!.id
      return addPhoto(db, await download(file.fileId), {
        ...splitCaption(message.caption),
        ownerId: owner,
        albumId,
        telegramFileUniqueId: file.fileUniqueId,
        createdBy: owner,
      })
    })

  const failureText = (error: unknown, language?: string) => {
    const text = botText(language)
    if (error instanceof UnsupportedImageError) return text.unsupported
    if (error instanceof QuotaExceededError) return text.full(error.limit)
    if (String(error).includes('unique')) return text.duplicate
    console.error('photo import failed', error)
    return text.failed
  }

  const openKeyboard = (language?: string) => {
    const link = appLink()
    const label = botText(language).open
    if (link) return new InlineKeyboard().url(label, link)
    return env.MINI_APP_URL ? new InlineKeyboard().webApp(label, env.MINI_APP_URL) : undefined
  }

  /** A finished album is ready to show off, so sharing it is offered right away. */
  const albumKeyboard = (albumId: string, language?: string) => {
    const keyboard = openKeyboard(language) ?? new InlineKeyboard()
    return appLinkBase ? keyboard.row().text(botText(language).shareAlbum, `sa:${packId(albumId)}`) : keyboard
  }

  /** What to do next once the bot speaks your language: open the gallery or add to it. */
  const startKeyboard = (language?: string) => {
    const keyboard = openKeyboard(language) ?? new InlineKeyboard()
    return keyboard.text(botText(language).upload, 'up')
  }

  const languageRow = (keyboard: InlineKeyboard) => {
    keyboard.row()
    for (const { code, label } of LANGUAGE_BUTTONS) keyboard.text(label, `lang:${code}`)
    return keyboard
  }

  const shareKeyboard = (link: string, language?: string) => {
    const text = botText(language)
    const forward = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text.shareText)}`
    return new InlineKeyboard().url(text.shareButton, forward).row().text(text.revoke, 'rv')
  }

  /** Buttons under a saved photo: open it, send it on, file it, or delete it. */
  const photoKeyboard = (photo: PhotoRow, language: string | undefined, inline: boolean) => {
    const text = botText(language)
    const id = packId(photo.id)
    const keyboard = new InlineKeyboard()
    const link = appLink(`photo_${photo.id}`)
    if (link) keyboard.url(text.view, link)
    else if (env.MINI_APP_URL) keyboard.webApp(text.view, env.MINI_APP_URL)
    if (inline) keyboard.switchInline(text.send, `#${id}`)
    return keyboard.row().text(text.toAlbum, `al:${id}`).text(text.remove, `rm:${id}`)
  }

  const albumGroups = new MediaGroupCollector<{ message: Message; file: IncomingFile }>(1500, (_, items) => {
    void (async () => {
      const chatId = items[0]!.message.chat.id
      const sender = items[0]!.message.from!
      const owner = sender.id
      const language = await resolveLanguage(db, sender)
      const text = botText(language)
      const progress = await bot.api.sendMessage(chatId, text.saving(items.length))
      const captioned = items.find(({ message }) => message.caption)
      const title = splitCaption(captioned?.message.caption).title || text.newAlbum
      const [album] = await db
        .insert(albums)
        .values({
          ownerId: owner,
          title,
          position: sql`(select coalesce(max(${albums.position}), 0) + 1 from ${albums} where ${albums.ownerId} = ${owner})`,
        })
        .returning()
      const results = await Promise.allSettled(items.map(({ message, file }) => save(message, file, album!.id)))
      const saved = results.filter((r) => r.status === 'fulfilled').length
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (saved === 0) await db.delete(albums).where(eq(albums.id, album!.id))
      const note = failure ? `\n${failureText(failure.reason, language)}` : ''
      const summary = saved > 0 ? text.albumAdded(title, saved) : ''
      await bot.api.editMessageText(chatId, progress.message_id, `${summary}${note}`.trim(), {
        parse_mode: 'HTML',
        reply_markup: saved > 0 ? albumKeyboard(album!.id, language) : undefined,
      })
    })().catch((error) => console.error('album import failed', error))
  })

  chat.command('start', async (ctx) => {
    const language = ctx.lang
    await applyChatLanguage(ctx.api, ctx.chat.id, language)
    await ctx.reply(botText(language).welcome, { reply_markup: languageRow(startKeyboard(language)) })
  })

  chat.command('language', (ctx) =>
    ctx.reply(botText(ctx.lang).chooseLanguage, { reply_markup: languageRow(new InlineKeyboard()) }),
  )

  bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
    const language = ctx.match[1] as Language
    await saveLanguage(db, ctx.from.id, language)
    if (ctx.chat) await applyChatLanguage(ctx.api, ctx.chat.id, language)
    await ctx.editMessageText(botText(language).languageSet, { reply_markup: startKeyboard(language) })
    await ctx.answerCallbackQuery()
  })

  bot.callbackQuery('up', async (ctx) => {
    const text = botText(ctx.lang)
    const inApp = appLink('upload')
    await ctx.reply(text.uploadHint, { reply_markup: inApp ? new InlineKeyboard().url(text.uploadInApp, inApp) : undefined })
    await ctx.answerCallbackQuery()
  })

  chat.command('help', (ctx) =>
    ctx.reply(botText(ctx.lang).help(ctx.me.supports_inline_queries).replace('{bot}', ctx.me.username), {
      parse_mode: 'HTML',
    }),
  )

  chat.command('gallery', (ctx) => {
    const language = ctx.lang
    return ctx.reply(botText(language).open, { reply_markup: openKeyboard(language) })
  })

  chat.command('share', async (ctx) => {
    const text = botText(ctx.lang)
    if (!appLinkBase) return ctx.reply(text.noAppLink)
    const token = await getOrCreateShare(db, ctx.from.id, ctx.from.first_name)
    const link = appLink(galleryStartParam(token))!
    return ctx.reply(text.shareLink(link), { link_preview_options: { is_disabled: true }, reply_markup: shareKeyboard(link, ctx.lang) })
  })

  chat.command('stats', async (ctx) => {
    const owner = ctx.from.id
    const [[photoCount], [albumCount], token] = await Promise.all([
      db.select({ total: count() }).from(photos).where(eq(photos.ownerId, owner)),
      db.select({ total: count() }).from(albums).where(eq(albums.ownerId, owner)),
      findShare(db, owner),
    ])
    const text = botText(ctx.lang)
    return ctx.reply(text.stats(photoCount?.total ?? 0, env.MAX_PHOTOS_PER_USER, albumCount?.total ?? 0, token !== null))
  })

  const onImage = async (ctx: BotContext) => {
    const message = ctx.message
    if (!message || !ctx.from) return
    const language = ctx.lang
    const text = botText(language)
    const file = imageFile(message)
    if (!file) return
    if (file.fileSize && file.fileSize > MAX_DOWNLOAD_BYTES) {
      await ctx.reply(text.tooLarge)
      return
    }
    if (message.media_group_id) {
      albumGroups.add({ groupId: message.media_group_id, item: { message, file } })
      return
    }
    await ctx.replyWithChatAction('upload_photo').catch(() => undefined)
    try {
      const photo = await save(message, file, null)
      await ctx.reply(text.added(photo.title), {
        parse_mode: 'HTML',
        reply_parameters: { message_id: message.message_id },
        reply_markup: photoKeyboard(photo, language, ctx.me.supports_inline_queries),
      })
    } catch (error) {
      await ctx.reply(failureText(error, language))
    }
  }

  chat.on(['message:photo', 'message:document'], onImage)

  /** Callback buttons act on the presser's own photo only; anything else reads as "not found". */
  const pressedPhoto = async (ctx: BotContext, packed: string) => {
    const id = unpackId(packed)
    const photo = id ? await ownedPhoto(db, ctx.from!.id, id) : null
    if (!photo) {
      await ctx.answerCallbackQuery({ text: botText(ctx.lang).notFound, show_alert: true })
      await ctx.editMessageReplyMarkup().catch(() => undefined)
    }
    return photo
  }

  bot.callbackQuery(/^al:([\w-]{22})$/, async (ctx) => {
    const photo = await pressedPhoto(ctx, ctx.match[1]!)
    if (!photo) return
    const text = botText(ctx.lang)
    const owned = await db
      .select({ id: albums.id, title: albums.title })
      .from(albums)
      .where(eq(albums.ownerId, ctx.from.id))
      .orderBy(albums.position, albums.createdAt)
      .limit(ALBUM_CHOICES)
    if (owned.length === 0) return ctx.answerCallbackQuery({ text: text.noAlbums, show_alert: true })
    const keyboard = new InlineKeyboard()
    const id = packId(photo.id)
    for (const album of owned) {
      const mark = album.id === photo.albumId ? '✓ ' : ''
      keyboard.text(`${mark}${album.title}`.slice(0, 60), `mv:${id}:${packId(album.id)}`).row()
    }
    keyboard.text(text.noAlbum, `mv:${id}:-`).text(text.back, `bk:${id}`)
    await ctx.editMessageReplyMarkup({ reply_markup: keyboard })
    await ctx.answerCallbackQuery({ text: text.chooseAlbum })
  })

  bot.callbackQuery(/^mv:([\w-]{22}):([\w-]{22}|-)$/, async (ctx) => {
    const photo = await pressedPhoto(ctx, ctx.match[1]!)
    if (!photo) return
    const text = botText(ctx.lang)
    const albumId = ctx.match[2] === '-' ? null : unpackId(ctx.match[2]!)
    const moved = await setPhotoAlbum(db, ctx.from.id, photo.id, albumId)
    if (!moved) return ctx.answerCallbackQuery({ text: text.notFound, show_alert: true })
    const [album] = albumId ? await db.select({ title: albums.title }).from(albums).where(eq(albums.id, albumId)) : []
    await ctx.editMessageText(album ? text.moved(album.title) : text.unfiled, {
      parse_mode: 'HTML',
      reply_markup: photoKeyboard(moved, ctx.lang, ctx.me.supports_inline_queries),
    })
    await ctx.answerCallbackQuery()
  })

  bot.callbackQuery(/^rm:([\w-]{22})$/, async (ctx) => {
    const photo = await pressedPhoto(ctx, ctx.match[1]!)
    if (!photo) return
    const text = botText(ctx.lang)
    const id = packId(photo.id)
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text(text.confirmYes, `rmy:${id}`).text(text.cancel, `bk:${id}`),
    })
    await ctx.answerCallbackQuery({ text: text.confirmDelete })
  })

  bot.callbackQuery(/^rmy:([\w-]{22})$/, async (ctx) => {
    const photo = await pressedPhoto(ctx, ctx.match[1]!)
    if (!photo) return
    await deletePhoto(db, ctx.from.id, photo.id)
    const text = botText(ctx.lang)
    await ctx.editMessageText(text.deleted)
    await ctx.answerCallbackQuery()
  })

  bot.callbackQuery(/^bk:([\w-]{22})$/, async (ctx) => {
    const photo = await pressedPhoto(ctx, ctx.match[1]!)
    if (!photo) return
    await ctx.editMessageReplyMarkup({ reply_markup: photoKeyboard(photo, ctx.lang, ctx.me.supports_inline_queries) })
    await ctx.answerCallbackQuery()
  })

  bot.callbackQuery(/^sa:([\w-]{22})$/, async (ctx) => {
    const text = botText(ctx.lang)
    const albumId = unpackId(ctx.match[1]!)
    if (!albumId || !appLinkBase || !(await ownsAlbum(db, ctx.from.id, albumId))) {
      return ctx.answerCallbackQuery({ text: text.notFound, show_alert: true })
    }
    const [album] = await db.select({ title: albums.title }).from(albums).where(eq(albums.id, albumId))
    const token = await getOrCreateShare(db, ctx.from.id, ctx.from.first_name)
    const link = appLink(galleryStartParam(token, albumId))!
    await ctx.reply(text.albumShareLink(album!.title, link), {
      link_preview_options: { is_disabled: true },
      reply_markup: shareKeyboard(link, ctx.lang),
    })
    await ctx.answerCallbackQuery()
  })

  bot.callbackQuery('rv', async (ctx) => {
    await revokeShare(db, ctx.from.id)
    await ctx.editMessageText(botText(ctx.lang).revoked)
    await ctx.answerCallbackQuery()
  })

  // Inline mode: "@bot words" in any chat lists the sender's own photos to send.
  bot.on('inline_query', async (ctx) => {
    const owner = ctx.from.id
    const query = ctx.inlineQuery.query.trim()
    const offset = Number(ctx.inlineQuery.offset) || 0
    const exact = query.startsWith('#') ? unpackId(query.slice(1)) : null
    const pattern = `%${escapeLike(query)}%`
    const where = exact
      ? and(eq(photos.ownerId, owner), eq(photos.id, exact))
      : query
        ? and(eq(photos.ownerId, owner), or(ilike(photos.title, pattern), ilike(photos.description, pattern)))
        : eq(photos.ownerId, owner)
    const rows = await db.select().from(photos).where(where).orderBy(photos.position, desc(photos.createdAt)).limit(INLINE_PAGE).offset(offset)
    const results: InlineQueryResultPhoto[] = rows.map((photo) => ({
      type: 'photo',
      id: photo.id,
      // Telegram needs JPEG here; full.jpg is the one JPEG every photo has.
      photo_url: `${mediaBase(photo.id)}/full.jpg`,
      thumbnail_url: `${mediaBase(photo.id)}/full.jpg`,
      photo_width: photo.width,
      photo_height: photo.height,
      title: photo.title || undefined,
      caption: photo.title ? html(photo.title) : undefined,
      parse_mode: 'HTML',
    }))
    const empty = rows.length === 0 && offset === 0 && !query
    await ctx.answerInlineQuery(results, {
      cache_time: 10,
      is_personal: true,
      next_offset: rows.length === INLINE_PAGE ? String(offset + INLINE_PAGE) : '',
      button: empty ? { text: botText(ctx.lang).inlineEmpty, start_parameter: 'inline' } : undefined,
    })
  })

  bot.catch(({ error }) => console.error('bot error', error))
  return bot
}

const commandMenu = (language: keyof typeof BOT_LANGUAGES) =>
  Object.entries(BOT_LANGUAGES[language].commands).map(([command, description]) => ({ command, description }))

/** Publishes the command menu in all three languages; Uzbek is the default for everyone else. */
export async function configureBot(bot: Bot<BotContext>) {
  await bot.api.setMyCommands(commandMenu('uz'))
  await bot.api.setMyCommands(commandMenu('ru'), { language_code: 'ru' })
  await bot.api.setMyCommands(commandMenu('en'), { language_code: 'en' })
}

/** A chosen language also renames this chat's command menu and its Mini App button. */
async function applyChatLanguage(api: Api, chatId: number, language?: string) {
  const code: keyof typeof BOT_LANGUAGES = language === 'ru' || language === 'en' ? language : 'uz'
  await api
    .setMyCommands(commandMenu(code), { scope: { type: 'chat', chat_id: chatId } })
    .catch((error) => console.error('chat commands not set', error))
  if (env.MINI_APP_URL) {
    await api
      .setChatMenuButton({ chat_id: chatId, menu_button: { type: 'web_app', text: botText(code).menu, web_app: { url: env.MINI_APP_URL } } })
      .catch((error) => console.error('menu button not set', error))
  }
}
