import { eq } from 'drizzle-orm'
import { createDb } from './db'
import { albums, photos } from './db/schema'
import { addPhoto } from './lib/photos'

/** Public-domain (CC0) works from The Met Open Access programme. */
const API = 'https://collectionapi.metmuseum.org/public/collection'
const CURATED = [
  { title: 'Mushuklar', q: 'cat', mustInclude: /\b(cats?|kittens?)\b/i, count: 12 },
  { title: 'Manzaralar', q: 'landscape', count: 10 },
  { title: 'Gullar', q: 'flowers', count: 8 },
  { title: 'Portretlar', q: 'portrait', count: 10 },
] as const

interface MetObject {
  title: string
  artistDisplayName: string
  objectDate: string
  isPublicDomain: boolean
  primaryImageSmall: string
  primaryImage: string
}

const getJson = async <T>(url: string): Promise<T | null> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  return response.ok ? ((await response.json()) as T) : null
}

async function findWorks(section: (typeof CURATED)[number]) {
  const params = new URLSearchParams({ hasImages: 'true', isPublicDomain: 'true', medium: 'Paintings', q: section.q, limit: '200' })
  const search = await getJson<{ objectIDs: number[] | null }>(`${API}/v1.1/search?${params}`)
  const works: MetObject[] = []
  for (const id of search?.objectIDs ?? []) {
    if (works.length >= section.count) break
    const work = await getJson<MetObject>(`${API}/v1/objects/${id}`).catch(() => null)
    if (!work?.isPublicDomain || !work.primaryImageSmall) continue
    if ('mustInclude' in section && !section.mustInclude.test(work.title)) continue
    works.push(work)
  }
  return works
}

const db = await createDb()
const existing = await db.select({ id: photos.id }).from(photos).limit(1)
if (existing.length > 0) {
  console.log('Gallery already has photos, skipping seed.')
  process.exit(0)
}

// New photos go to the front, so the cats are imported last to open the gallery.
for (const [position, section] of [...CURATED.entries()].reverse()) {
  const [album] = await db.insert(albums).values({ title: section.title, position }).returning()
  let added = 0
  for (const work of await findWorks(section)) {
    try {
      const response = await fetch(work.primaryImageSmall, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) continue
      await addPhoto(db, Buffer.from(await response.arrayBuffer()), {
        albumId: album!.id,
        title: work.title.slice(0, 120),
        description: work.objectDate,
        credit: [work.artistDisplayName, 'The Met, CC0'].filter(Boolean).join(' · '),
      })
      added++
    } catch (error) {
      console.warn(`Skipped "${work.title}":`, error)
    }
  }
  console.log(`${section.title}: ${added}`)
  if (added === 0) await db.delete(albums).where(eq(albums.id, album!.id))
}
process.exit(0)
