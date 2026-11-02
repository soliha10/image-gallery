import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { shares } from '../db/schema'

/** One stable read-only link per owner; revoking it means the next one is new. */
export async function getOrCreateShare(db: Db, ownerId: number, ownerName: string) {
  const [row] = await db
    .insert(shares)
    .values({ ownerId, token: randomBytes(16).toString('base64url'), ownerName })
    .onConflictDoUpdate({ target: shares.ownerId, set: { ownerName } })
    .returning({ token: shares.token })
  return row!.token
}

export async function findShare(db: Db, ownerId: number) {
  const [row] = await db.select({ token: shares.token }).from(shares).where(eq(shares.ownerId, ownerId))
  return row?.token ?? null
}

export async function revokeShare(db: Db, ownerId: number) {
  await db.delete(shares).where(eq(shares.ownerId, ownerId))
}
