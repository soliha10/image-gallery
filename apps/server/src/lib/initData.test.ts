import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateInitData } from './initData'

const TOKEN = '123:abc'
const NOW = 1_800_000_000_000

function sign(fields: Record<string, string>, token = TOKEN) {
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(check).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}

const fields = (authDate = NOW / 1000) => ({
  auth_date: String(authDate),
  query_id: 'q',
  user: JSON.stringify({ id: 42, first_name: 'Ali' }),
})

describe('validateInitData', () => {
  it('accepts correctly signed data', () => {
    expect(validateInitData(sign(fields()), TOKEN, 3600, NOW)?.id).toBe(42)
  })
  it('rejects tampered data', () => {
    const tampered = sign(fields()).replace('42', '43')
    expect(validateInitData(tampered, TOKEN, 3600, NOW)).toBeNull()
  })
  it('rejects data signed with another token', () => {
    expect(validateInitData(sign(fields(), '999:zzz'), TOKEN, 3600, NOW)).toBeNull()
  })
  it('rejects expired data', () => {
    expect(validateInitData(sign(fields(NOW / 1000 - 7200)), TOKEN, 3600, NOW)).toBeNull()
  })
  it('rejects missing or malformed hash', () => {
    expect(validateInitData('auth_date=1', TOKEN, 3600, NOW)).toBeNull()
    expect(validateInitData('auth_date=1&hash=zz', TOKEN, 3600, NOW)).toBeNull()
  })
})
