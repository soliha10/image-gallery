/**
 * Telegram limits callback data to 64 bytes, too little for two UUIDs as text. Base64url packs
 * each into 22 characters.
 */
export function packId(uuid: string) {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex').toString('base64url')
}

export function unpackId(packed: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(packed)) return null
  const hex = Buffer.from(packed, 'base64url').toString('hex')
  if (hex.length !== 32) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
