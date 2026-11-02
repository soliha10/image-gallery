import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { closeDb, createDb } from './db'
import { albums, photos } from './db/schema'
import { env } from './env'
import { localMediaRoot, storage, usesLocalStorage } from './lib/storage'

const CONTENT_TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' }

/** Copies the local gallery to production. Running it again skips what is already there. */
if (!env.DATABASE_URL || usesLocalStorage) {
  console.error('.env.production needs DATABASE_URL and S3_BUCKET, otherwise there is nowhere to copy to.')
  process.exit(1)
}

// Two processes on one PGlite folder can corrupt it, so the dev server has to be stopped first.
const devServer = await fetch('http://localhost:3000/healthz').catch(() => null)
if (devServer) {
  console.error('Stop pnpm dev first, then run this again.')
  process.exit(1)
}

const client = new PGlite(env.PGLITE_DIR)
const local = drizzle(client)
const target = await createDb()

const localAlbums = await local.select().from(albums)
const localPhotos = await local.select().from(photos)

if (localAlbums.length > 0) await target.insert(albums).values(localAlbums).onConflictDoNothing()

let copied = 0
for (const photo of localPhotos) {
  const folder = join(localMediaRoot, 'photos', photo.id)
  const files = await readdir(folder)
  // Files go first, so a row in the database always has its images.
  await Promise.all(
    files.map(async (name) =>
      storage.put(`photos/${photo.id}/${name}`, await readFile(join(folder, name)), CONTENT_TYPES[extname(name)] ?? 'application/octet-stream'),
    ),
  )
  await target.insert(photos).values(photo).onConflictDoNothing()
  console.log(`${++copied}/${localPhotos.length} ${photo.title || photo.id}`)
}

await client.close()
await closeDb()
console.log(`Done: ${localAlbums.length} albums, ${copied} photos.`)
process.exit(0)
