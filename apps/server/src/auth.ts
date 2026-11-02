import type { FastifyReply, FastifyRequest } from 'fastify'
import { devAuthEnabled, env } from './env'
import { validateInitData, type TelegramUser } from './lib/initData'

declare module 'fastify' {
  interface FastifyRequest {
    tgUser: TelegramUser
  }
}

export const DEV_USER: TelegramUser = { id: 1, first_name: 'Dev', language_code: 'uz' }

export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (devAuthEnabled) {
    request.tgUser = DEV_USER
    return
  }
  const [scheme, initData] = (request.headers.authorization ?? '').split(' ')
  const user =
    scheme === 'tma' && initData && env.BOT_TOKEN
      ? validateInitData(initData, env.BOT_TOKEN, env.INIT_DATA_MAX_AGE_SECONDS)
      : null
  if (!user) return reply.code(401).send({ error: 'unauthorized' })
  request.tgUser = user
}
