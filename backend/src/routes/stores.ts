import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { Platform } from '@prisma/client'

const storeSchema = z.object({
  name:       z.string().min(1),
  platform:   z.nativeEnum(Platform),
  apiKey:     z.string().optional(),
  apiSecret:  z.string().optional(),
  webhookUrl: z.string().url().optional(),
})

type StoreBody = z.infer<typeof storeSchema>
type IdParam   = { Params: { id: string } }

export async function storeRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/stores
  server.get(
    '/',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      const stores = await prisma.store.findMany({
        where: { userId: sub },
        orderBy: { createdAt: 'asc' },
      })

      return reply.send(stores)
    },
  )

  // POST /api/stores
  server.post<{ Body: StoreBody }>(
    '/',
    { preHandler },
    async (request: FastifyRequest<{ Body: StoreBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body    = storeSchema.parse(request.body)

      const store = await prisma.store.create({ data: { ...body, userId: sub } })
      return reply.status(201).send(store)
    },
  )

  // PATCH /api/stores/:id
  server.patch<IdParam & { Body: Partial<StoreBody> }>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam & { Body: Partial<StoreBody> }>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const exists = await prisma.store.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Loja não encontrada' })

      const body  = storeSchema.partial().parse(request.body)
      const store = await prisma.store.update({ where: { id }, data: body })

      return reply.send(store)
    },
  )

  // DELETE /api/stores/:id
  server.delete<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const exists = await prisma.store.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Loja não encontrada' })

      await prisma.store.delete({ where: { id } })
      return reply.status(204).send()
    },
  )
}
