import { bigint, index, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

/** Every gallery belongs to one Telegram user; rows from before galleries were personal have no owner yet. */
export const albums = pgTable(
  'albums',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: bigint({ mode: 'number' }),
    title: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('albums_owner_position').on(t.ownerId, t.position)],
)

export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: bigint({ mode: 'number' }),
    albumId: uuid().references(() => albums.id, { onDelete: 'set null' }),
    title: text().notNull().default(''),
    description: text().notNull().default(''),
    credit: text(),
    width: integer().notNull(),
    height: integer().notNull(),
    blurhash: text().notNull(),
    position: integer().notNull().default(0),
    telegramFileUniqueId: text(),
    createdBy: bigint({ mode: 'number' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('photos_album_position').on(t.albumId, t.position),
    index('photos_owner_position').on(t.ownerId, t.position),
    // The same Telegram file may sit in several people's galleries, but only once in each.
    unique('photos_owner_telegram_file').on(t.ownerId, t.telegramFileUniqueId),
  ],
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

/** A gallery owner's public link. The token stands in for the owner's Telegram id in shared URLs. */
export const shares = pgTable('shares', {
  ownerId: bigint({ mode: 'number' }).primaryKey(),
  token: text().notNull().unique(),
  ownerName: text().notNull().default(''),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
