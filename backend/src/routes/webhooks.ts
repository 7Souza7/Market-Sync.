import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { webhookProcessor } from '../services/webhook.processor'

type StoreIdParam = { Params: { storeId: string } }
type EventIdParam = { Params: { id: string } }
type EventsQuery  = { Querystring: { storeId?: string; status?: string; limit?: string } }

function verifyShopify(rawBody: Buffer, secret: string, signature: string): boolean {
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

export async function webhookRoutes(server: FastifyInstance) {

  // POST /api/webhooks/shopify/:storeId
  server.post<StoreIdParam>(
    '/shopify/:storeId',
    async (request: FastifyRequest<StoreIdParam>, reply: FastifyReply) => {
      const { storeId } = request.params
      const store = await prisma.store.findUnique({ where: { id: storeId } })
      if (!store) return reply.status(404).send({ error: 'Store not found' })

      if ((store as any)?.webhookSecret) {
        const sig = request.headers['x-shopify-hmac-sha256'] as string
        const rawBody = (request as any).rawBody as Buffer

      if (!sig || !verifyShopify(rawBody, (store as any).webhookSecret, sig)) {
      return reply.status(401).send({ error: 'Invalid signature' })
  }
}

      const topic   = request.headers['x-shopify-topic'] as string
      const body    = request.body as Record<string, unknown>
      const extId   = String((body.id ?? body.order_id) ?? '')

      const event = await prisma.webhookEvent.create({
  data: {
    storeId,
    platform: 'SHOPIFY',
    eventType: topic ?? 'unknown',
    externalId: extId,
    payload: body as any,
    status: 'PENDING',
  },
})

      webhookProcessor.process(event).catch(() => {})
      return reply.status(200).send({ received: true })
    },
  )

  // POST /api/webhooks/shopee/:storeId
  server.post<StoreIdParam>(
    '/shopee/:storeId',
    async (request: FastifyRequest<StoreIdParam>, reply: FastifyReply) => {
      const { storeId } = request.params
      const store = await prisma.store.findUnique({ where: { id: storeId } })
      if (!store) return reply.status(404).send({ error: 'Store not found' })

      const body  = request.body as Record<string, unknown>
      const event = await prisma.webhookEvent.create({
  data: {
    storeId,
    platform: 'SHOPEE',
    eventType: String(body.code ?? 'unknown'),
    externalId: String(body.ordersn ?? body.item_id ?? ''),
    payload: body as any,
    status: 'PENDING',
  },
})

      webhookProcessor.process(event).catch(() => {})
      return reply.status(200).send({ received: true })
    },
  )

  // POST /api/webhooks/mercadolivre/:storeId
  server.post<StoreIdParam>(
    '/mercadolivre/:storeId',
    async (request: FastifyRequest<StoreIdParam>, reply: FastifyReply) => {
      const { storeId } = request.params
      const body  = request.body as Record<string, unknown>

      const event = await prisma.webhookEvent.create({
  data: {
    storeId,
    platform: 'SHOPEE',
    eventType: String(body.code ?? 'unknown'),
    externalId: String(body.ordersn ?? body.item_id ?? ''),
    payload: body as any,
    status: 'PENDING',
  },
})

      webhookProcessor.process(event).catch(() => {})
      return reply.status(200).send({ received: true })
    },
  )

  // POST /api/webhooks/amazon/:storeId
  server.post<StoreIdParam>(
    '/amazon/:storeId',
    async (request: FastifyRequest<StoreIdParam>, reply: FastifyReply) => {
      const { storeId } = request.params
      const body  = request.body as Record<string, unknown>

      const event = await prisma.webhookEvent.create({
  data: {
    storeId,
    platform: 'SHOPEE',
    eventType: String(body.code ?? 'unknown'),
    externalId: String(body.ordersn ?? body.item_id ?? ''),
    payload: body as any,
    status: 'PENDING',
  },
})

      webhookProcessor.process(event).catch(() => {})
      return reply.status(200).send({ received: true })
    },
  )

  // GET /api/webhooks/events
  server.get<EventsQuery>(
    '/events',
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest<EventsQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const { storeId, status, limit } = request.query

      const events = await prisma.webhookEvent.findMany({
        where: {
          store: { userId: sub },
          ...(storeId ? { storeId }                  : {}),
          ...(status  ? { status: status as any }    : {}),
        },
        orderBy: { createdAt: 'desc' },
        take:    Number(limit ?? 50),
        include: { store: { select: { name: true, platform: true } } },
      })

      return reply.send(events)
    },
  )

  // POST /api/webhooks/events/:id/retry
  server.post<EventIdParam>(
    '/events/:id/retry',
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest<EventIdParam>, reply: FastifyReply) => {
      const { id } = request.params

      const event = await prisma.webhookEvent.findUnique({ where: { id } })
      if (!event) return reply.status(404).send({ error: 'Evento não encontrado' })

      await prisma.webhookEvent.update({ where: { id }, data: { status: 'PENDING', error: null } })
      webhookProcessor.process({ ...event, status: 'PENDING' }).catch(() => {})

      return reply.send({ queued: true })
    },
  )
}
