import { z } from 'zod'

export const IMAGE_WIDTHS = [400, 800, 1600] as const
export type ImageWidth = (typeof IMAGE_WIDTHS)[number]

export interface Album {
  id: string
  title: string
  position: number
  photoCount: number
  coverUrl: string | null
}

export interface Photo {
  id: string
  albumId: string | null
  title: string
  description: string
  credit: string | null
  width: number
  height: number
  blurhash: string
  /** Base URL without size or extension: `${base}/800.webp` */
  base: string
  createdAt: string
}

export interface PhotoPage {
  items: Photo[]
  nextCursor: string | null
  total: number
}

export interface Me {
  id: number
  firstName: string
  languageCode: string | null
  favoriteIds: string[]
  photoCount: number
  photoLimit: number
  /** Chosen in the bot or the app; null means follow Telegram's language. */
  language: 'uz' | 'ru' | 'en' | null
}

/** Base64url, as Telegram only allows these characters in a startapp parameter. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{16,48}$/)

export interface SharedGallery {
  ownerName: string
  photoCount: number
}

export interface Share {
  token: string | null
}

export const photoQuerySchema = z.object({
  gallery: shareTokenSchema.optional(),
  album: z.uuid().optional(),
  q: z.string().trim().max(80).optional(),
  favorites: z.enum(['1']).optional(),
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(60),
})

export const photoPatchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  albumId: z.uuid().nullable().optional(),
})

export const reorderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(1000) })

export const albumInputSchema = z.object({ title: z.string().trim().min(1).max(80) })

export const albumReorderSchema = reorderSchema

export const albumQuerySchema = z.object({ gallery: shareTokenSchema.optional() })

export const photoUrl = (photo: Pick<Photo, 'base'>, width: ImageWidth, ext: 'webp' | 'avif' = 'webp') =>
  `${photo.base}/${width}.${ext}`

/**
 * The Mini App link is typed by hand into hosting settings, so it is often missing https:// or
 * has stray spaces. Returns a clean https URL, or null when the value cannot be one.
 */
export function normalizeAppLink(value: string | undefined | null): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Packs a UUID into 22 base64url characters. Telegram allows only 64 characters in callback data
 * and in a startapp parameter, too few for UUIDs written out. Pure JS, so it runs in the browser too.
 */
export function packId(uuid: string) {
  const hex = uuid.replace(/-/g, '')
  let bits = ''
  for (let i = 0; i < hex.length; i++) bits += parseInt(hex[i]!, 16).toString(2).padStart(4, '0')
  bits = bits.padEnd(132, '0')
  let out = ''
  for (let i = 0; i < 132; i += 6) out += BASE64URL[parseInt(bits.slice(i, i + 6), 2)]
  return out
}

export function unpackId(packed: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(packed)) return null
  let bits = ''
  for (const char of packed) bits += BASE64URL.indexOf(char).toString(2).padStart(6, '0')
  if (/1/.test(bits.slice(128))) return null
  let hex = ''
  for (let i = 0; i < 128; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const SHARE_TOKEN_LENGTH = 22

/** Start parameter for a shared gallery, optionally opening straight at one of its albums. */
export const galleryStartParam = (token: string, albumId?: string | null) => `g_${token}${albumId ? packId(albumId) : ''}`

export function parseGalleryStart(param: string): { token: string; albumId: string | null } | null {
  if (!param.startsWith('g_')) return null
  const body = param.slice(2)
  // Tokens are always 22 characters, so an album id, when present, is exactly what follows.
  if (body.length === SHARE_TOKEN_LENGTH) return shareTokenSchema.safeParse(body).success ? { token: body, albumId: null } : null
  if (body.length !== SHARE_TOKEN_LENGTH * 2) return null
  const token = body.slice(0, SHARE_TOKEN_LENGTH)
  const albumId = unpackId(body.slice(SHARE_TOKEN_LENGTH))
  return albumId && shareTokenSchema.safeParse(token).success ? { token, albumId } : null
}

export const LANGUAGES = ['uz', 'ru', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const languageSchema = z.object({ language: z.enum(LANGUAGES) })
