import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.url().optional(),
  BOT_TOKEN: z.string().optional(),
  BOT_WEBHOOK_SECRET: z.string().optional(),
  MINI_APP_URL: z.url().optional(),
  ADMIN_IDS: z.string().default(''),
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('.data/pglite'),
  STORAGE_DIR: z.string().default('.data/media'),
  MEDIA_BASE_URL: z.string().default('/media'),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  CORS_ORIGIN: z.string().optional(),
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().default(86400),
  SENTRY_DSN: z.string().optional(),
})

const parsed = schema.parse(
  Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v])),
)

if (parsed.NODE_ENV === 'production' && !parsed.BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required in production')
}
if (parsed.NODE_ENV === 'production' && parsed.PUBLIC_URL && !parsed.BOT_WEBHOOK_SECRET) {
  throw new Error('BOT_WEBHOOK_SECRET is required when using a webhook')
}

export const env = parsed
export const adminIds = new Set(
  parsed.ADMIN_IDS.split(',').map((id) => Number(id.trim())).filter(Boolean),
)
export const devAuthEnabled = parsed.NODE_ENV !== 'production' && !parsed.BOT_TOKEN
