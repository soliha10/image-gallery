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
  isAdmin: boolean
  favoriteIds: string[]
}

export const photoQuerySchema = z.object({
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

export const photoUrl = (photo: Pick<Photo, 'base'>, width: ImageWidth, ext: 'webp' | 'avif' = 'webp') =>
  `${photo.base}/${width}.${ext}`
