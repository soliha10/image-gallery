import { Bot, InlineKeyboard, type Context } from 'grammy'
import type { Message } from 'grammy/types'
import { sql } from 'drizzle-orm'
import type { Db } from './db'
import { albums } from './db/schema'
import { env } from './env'
import { UnsupportedImageError } from './lib/image'
import { MediaGroupCollector } from './lib/mediaGroup'
import { addPhoto, QuotaExceededError } from './lib/photos'

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

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

export function createBot(token: string, db: Db) {
  const bot = new Bot(token)

  const download = async (fileId: string) => {
    // The file URL embeds the bot token, so it stays inside this function.
    const file = await bot.api.getFile(fileId)
    const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
    if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  // Each sender's photos land in their own gallery.
  const save = async (message: Message, file: IncomingFile, albumId: string | null) => {
    const owner = message.from!.id
    await addPhoto(db, await download(file.fileId), {
      ...splitCaption(message.caption),
      ownerId: owner,
      albumId,
      telegramFileUniqueId: file.fileUniqueId,
      createdBy: owner,
    })
  }

  const failureText = (error: unknown) => {
    if (error instanceof UnsupportedImageError) return 'Bu format qo‘llab-quvvatlanmaydi. JPEG, PNG, WebP yoki AVIF yuboring.'
    if (error instanceof QuotaExceededError) return `Galereyangiz to‘ldi: ${error.limit} ta rasm. Yangisini qo‘shish uchun eskilarini o‘chiring.`
    if (String(error).includes('unique')) return 'Bu rasm galereyada allaqachon bor.'
    console.error('photo import failed', error)
    return 'Rasmni saqlab bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.'
  }

  const albums_ = new MediaGroupCollector<{ message: Message; file: IncomingFile }>(1500, (_, items) => {
    void (async () => {
      const chatId = items[0]!.message.chat.id
      const owner = items[0]!.message.from!.id
      const captioned = items.find(({ message }) => message.caption)
      const title = splitCaption(captioned?.message.caption).title || 'Yangi albom'
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
      const note = failure ? ` ${failureText(failure.reason)}` : ''
      await bot.api.sendMessage(chatId, `«${title}» albomiga ${saved} ta rasm qo‘shildi.${note}`)
    })().catch((error) => console.error('album import failed', error))
  })

  const openButton = () =>
    env.MINI_APP_URL ? new InlineKeyboard().webApp('Galereyani ochish', env.MINI_APP_URL) : undefined

  bot.command('start', (ctx) =>
    ctx.reply(
      'Xush kelibsiz! Bu sizning shaxsiy galereyangiz: menga rasm yuboring, mushukcha uni yulduzlar orasiga ilib qo‘yadi. Albom uchun bir nechta rasmni birga yuboring, birinchi izoh albom nomi bo‘ladi.',
      { reply_markup: openButton() },
    ),
  )

  const onImage = async (ctx: Context) => {
    const message = ctx.message
    if (!message || !ctx.from) return
    const file = imageFile(message)
    if (!file) return
    if (file.fileSize && file.fileSize > MAX_DOWNLOAD_BYTES) {
      await ctx.reply('Rasm 20 MB dan katta. Telegram botlarga bundan katta faylni bermaydi, kichikroq rasm yuboring.')
      return
    }
    if (message.media_group_id) {
      albums_.add({ groupId: message.media_group_id, item: { message, file } })
      return
    }
    try {
      await save(message, file, null)
      await ctx.reply('Rasm galereyangizga qo‘shildi.', { reply_markup: openButton() })
    } catch (error) {
      await ctx.reply(failureText(error))
    }
  }

  bot.on(['message:photo', 'message:document'], onImage)
  bot.catch(({ error }) => console.error('bot error', error))
  return bot
}
