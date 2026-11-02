import { bigint, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const albums = pgTable('albums', {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  position: integer().notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    albumId: uuid().references(() => albums.id, { onDelete: 'set null' }),
    title: text().notNull().default(''),
    description: text().notNull().default(''),
    credit: text(),
    width: integer().notNull(),
    height: integer().notNull(),
    blurhash: text().notNull(),
    position: integer().notNull().default(0),
    telegramFileUniqueId: text().unique(),
    createdBy: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('photos_album_position').on(t.albumId, t.position)],
)

export const favorites = pgTable(
  'favorites',
  {
    userId: bigint({ mode: 'number' }).notNull(),
    photoId: uuid()
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.photoId] })],
)
