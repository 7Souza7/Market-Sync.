import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { AdPlatform, AdStatus } from '@prisma/client'

const adSchema = z.object({
  name:           z.string().min(1),
  platform:       z.nativeEnum(AdPlatform),
  headline:       z.string().min(1),
  description:    z.string(),
  budget:         z.number().positive(),
  targetAudience: z.string().optional(),
  imageUrl:       z.string().url().optional(),
  storeId:        z.string().optional(),
  startDate:      z.string().datetime().optional(),
  endDate:        z.string().datetime().optional(),
})

type AdBody      = z.infer<typeof adSchema>
type AdBodyPatch = Partial<AdBody>
type IdParam     = { Params: { id: string } }
type ListQuery   = { Querystring: { platform?: string; status?: string } }
type StatusBody  = { Body: { status: AdStatus } }

export async function adRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/ads
  server.get<ListQuery>(
    '/',
    { preHandler },
    async (request: FastifyRequest<ListQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const { platform, status } = request.query

      const ads = await prisma.ad.findMany({
        where: {
          userId: sub,
          ...(platform ? { platform: platform as AdPlatform } : {}),
          ...(status   ? { status: status as AdStatus }       : {}),
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(ads)
    },
  )

  // POST /api/ads
  server.post<{ Body: AdBody }>(
    '/',
    { preHandler },
    async (request: FastifyRequest<{ Body: AdBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body = adSchema.parse(request.body)

      const ad = await prisma.ad.create({
        data: { ...body, userId: sub, status: AdStatus.DRAFT },
      })

      return reply.status(201).send(ad)
    },
  )

  // GET /api/ads/:id
  server.get<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id } = request.params
      const { sub } = request.user as { sub: string }

      const ad = await prisma.ad.findFirst({ where: { id, userId: sub } })
      if (!ad) return reply.status(404).send({ error: 'Anúncio não encontrado' })

      return reply.send(ad)
    },
  )

  // PATCH /api/ads/:id
  server.patch<IdParam & { Body: AdBodyPatch }>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam & { Body: AdBodyPatch }>, reply: FastifyReply) => {
      const { id } = request.params
      const { sub } = request.user as { sub: string }

      const exists = await prisma.ad.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Anúncio não encontrado' })

      const body = adSchema.partial().parse(request.body)
      const ad   = await prisma.ad.update({ where: { id }, data: body })

      return reply.send(ad)
    },
  )

  // PATCH /api/ads/:id/status
  server.patch<IdParam & StatusBody>(
    '/:id/status',
    { preHandler },
    async (request: FastifyRequest<IdParam & StatusBody>, reply: FastifyReply) => {
      const { id }     = request.params
      const { status } = request.body
      const { sub } = request.user as { sub: string }

      const exists = await prisma.ad.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Anúncio não encontrado' })

      const ad = await prisma.ad.update({ where: { id }, data: { status } })
      return reply.send(ad)
    },
  )

  // DELETE /api/ads/:id
  server.delete<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const exists = await prisma.ad.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Anúncio não encontrado' })

      await prisma.ad.delete({ where: { id } })
      return reply.status(204).send()
    },
  )
}
