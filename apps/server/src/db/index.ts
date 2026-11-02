import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'
import { env } from '../env'
import * as schema from './schema'

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

/** Uses Postgres when DATABASE_URL is set, otherwise embedded PGlite so dev needs no services. */
export async function createDb(): Promise<Db> {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 })
    const db = drizzlePg(pool, { schema })
    await migratePg(db, { migrationsFolder })
    return db as unknown as Db
  }
  mkdirSync(env.PGLITE_DIR, { recursive: true })
  const db = drizzlePglite(new PGlite(env.PGLITE_DIR), { schema })
  await migratePglite(db, { migrationsFolder })
  return db as unknown as Db
}
