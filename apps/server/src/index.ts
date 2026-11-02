import * as Sentry from '@sentry/node'
import { buildApp } from './app'
import { configureBot, createBot } from './bot'
import { DEV_USER } from './auth'
import { closeDb, createDb } from './db'
import { devAuthEnabled, env } from './env'
import { claimUnowned } from './lib/photos'

if (env.SENTRY_DSN) Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV })

const db = await createDb()
const legacyOwner = env.LEGACY_OWNER_ID ?? (devAuthEnabled ? DEV_USER.id : undefined)
if (legacyOwner) await claimUnowned(db, legacyOwner)
const bot = env.BOT_TOKEN ? createBot(env.BOT_TOKEN, db) : null
const app = await buildApp(db, bot)

await app.listen({ port: env.PORT, host: '0.0.0.0' })

if (bot) {
  await configureBot(bot).catch((error) => app.log.error(error, 'bot commands not set'))
  if (env.PUBLIC_URL) {
    await bot.api
      .setWebhook(`${env.PUBLIC_URL}/telegram/webhook`, {
        secret_token: env.BOT_WEBHOOK_SECRET,
        allowed_updates: ['message'],
      })
      .catch((error) => app.log.error(error, 'webhook not set'))
  } else {
    bot.start({ allowed_updates: ['message'] }).catch((error) => app.log.error(error, 'bot polling stopped'))
  }
  if (env.MINI_APP_URL) {
    await bot.api
      .setChatMenuButton({ menu_button: { type: 'web_app', text: 'Galereya', web_app: { url: env.MINI_APP_URL } } })
      .catch((error) => app.log.error(error, 'menu button not set'))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.allSettled([app.close(), bot?.stop()])
      .then(() => closeDb())
      .finally(() => process.exit(0))
  })
}
