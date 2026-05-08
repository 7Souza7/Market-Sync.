import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { CustomerSegment } from '@prisma/client'

const customerSchema = z.object({
  name:    z.string().min(1),
  email:   z.string().email().optional(),
  phone:   z.string().optional(),
  cpf:     z.string().optional(),
  cnpj:    z.string().optional(),
  segment: z.nativeEnum(CustomerSegment).optional(),
  notes:   z.string().optional(),
})

type CustomerBody  = z.infer<typeof customerSchema>
type IdParam       = { Params: { id: string } }
type ListQuery     = { Querystring: { segment?: string; search?: string } }

export async function customerRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/customers
  server.get<ListQuery>(
    '/',
    { preHandler },
    async (request: FastifyRequest<ListQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string } as { sub: string }
      const { segment, search }  = request.query

      const customers = await prisma.customer.findMany({
        where: {
          userId: sub,
          ...(segment ? { segment: segment as CustomerSegment } : {}),
          ...(search  ? {
            OR: [
              { name:  { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          } : {}),
        },
        orderBy: { totalSpent: 'desc' },
      })

      return reply.send(customers)
    },
  )

  // POST /api/customers
  server.post<{ Body: CustomerBody }>(
    '/',
    { preHandler },
    async (request: FastifyRequest<{ Body: CustomerBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string } as { sub: string }
      const body    = customerSchema.parse(request.body)

      const customer = await prisma.customer.create({ data: { ...body, userId: sub } })
      return reply.status(201).send(customer)
    },
  )

  // GET /api/customers/:id
  server.get<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const customer = await prisma.customer.findFirst({
        where: { id, userId: sub },
        include: { orders: { orderBy: { createdAt: 'desc' }, take: 10 } },
      })
      if (!customer) return reply.status(404).send({ error: 'Cliente não encontrado' })

      return reply.send(customer)
    },
  )

  // PATCH /api/customers/:id
  server.patch<IdParam & { Body: Partial<CustomerBody> }>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam & { Body: Partial<CustomerBody> }>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const exists = await prisma.customer.findFirst({ where: { id, userId: sub } })
      if (!exists) return reply.status(404).send({ error: 'Cliente não encontrado' })

      const body     = customerSchema.partial().parse(request.body)
      const customer = await prisma.customer.update({ where: { id }, data: body })

      return reply.send(customer)
    },
  )
}
