import { LANGUAGES, type Language } from '@gallery/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { userSettings } from '../db/schema'

/** Looked up on every bot update, so choices are remembered in memory once read. */
const cache = new Map<number, Language | null>()

export async function savedLanguage(db: Db, userId: number): Promise<Language | null> {
  if (cache.has(userId)) return cache.get(userId)!
  const [row] = await db.select({ language: userSettings.language }).from(userSettings).where(eq(userSettings.userId, userId))
  const language = LANGUAGES.find((code) => code === row?.language) ?? null
  cache.set(userId, language)
  return language
}

export async function saveLanguage(db: Db, userId: number, language: Language) {
  await db
    .insert(userSettings)
    .values({ userId, language })
    .onConflictDoUpdate({ target: userSettings.userId, set: { language, updatedAt: new Date() } })
  cache.set(userId, language)
}

/** A choice made in the bot or the app wins over the language Telegram reports. */
export async function resolveLanguage(db: Db, user: { id: number; language_code?: string }) {
  return (await savedLanguage(db, user.id)) ?? user.language_code
}
