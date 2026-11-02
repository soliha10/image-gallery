import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { webhookCallback, type Bot } from 'grammy'
import { ZodError } from 'zod'
import type { Db } from './db'
import { env } from './env'
import { localMediaRoot, usesLocalStorage } from './lib/storage'
import { apiRoutes } from './routes/api'

const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')

export async function buildApp(db: Db, bot: Bot | null) {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  })

  await app.register(helmet, {
    // Telegram Web embeds the Mini App in an iframe.
    frameguard: false,
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
  await app.register(cors, { origin: env.CORS_ORIGIN?.split(',') ?? false })
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', allowList: (r) => !r.url.startsWith('/api') })
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'invalid_request' })
    const status = (error as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) request.log.error(error)
    return reply.code(status).send({ error: status >= 500 ? 'internal_error' : (error as Error).message })
  })

  app.get('/healthz', () => ({ ok: true }))
  await app.register(apiRoutes, { prefix: '/api', db })

  // grammY refuses long polling once a webhook handler exists, so the route is webhook-only.
  if (bot && env.PUBLIC_URL) {
    const handle = webhookCallback(bot, 'fastify', { secretToken: env.BOT_WEBHOOK_SECRET })
    app.post('/telegram/webhook', handle)
  }

  if (usesLocalStorage) {
    await app.register(fastifyStatic, {
      root: localMediaRoot,
      prefix: '/media/',
      decorateReply: false,
      immutable: true,
      maxAge: '1y',
      setHeaders(res, path) {
        res.raw.setHeader('Access-Control-Allow-Origin', '*')
        if (path.endsWith('full.jpg')) res.raw.setHeader('Content-Disposition', 'attachment; filename="photo.jpg"')
      },
    })
  }

  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders(res, path) {
        res.raw.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
      },
    })
    app.setNotFoundHandler((request, reply) =>
      /^\/(api|assets|media)\//.test(request.url)
        ? reply.code(404).send({ error: 'not_found' })
        : reply.sendFile('index.html'),
    )
  }

  return app
}
