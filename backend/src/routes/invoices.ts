import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { InvoiceStatus } from '@prisma/client'
import { invoiceService } from '../services/invoice.service'

const invoiceSchema = z.object({
  customerName: z.string().min(1),
  customerDoc:  z.string().min(11),
  description:  z.string().min(1),
  cfop:         z.string().default('5.102'),
  amount:       z.number().positive(),
  nature:       z.string().default('Venda de mercadoria'),
  customerId:   z.string().optional(),
  orderId:      z.string().optional(),
})

type InvoiceBody  = z.infer<typeof invoiceSchema>
type IdParam      = { Params: { id: string } }
type StatusQuery  = { Querystring: { status?: string } }

export async function invoiceRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/invoices
  server.get<StatusQuery>(
    '/',
    { preHandler },
    async (request: FastifyRequest<StatusQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string } as { sub: string }
      const { status } = request.query

      const invoices = await prisma.invoice.findMany({
        where: {
          userId: sub,
          ...(status ? { status: status as InvoiceStatus } : {}),
        },
        include: { customer: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(invoices)
    },
  )

  // POST /api/invoices
  server.post<{ Body: InvoiceBody }>(
    '/',
    { preHandler },
    async (request: FastifyRequest<{ Body: InvoiceBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body    = invoiceSchema.parse(request.body)

      const last = await prisma.invoice.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      })
      const nextNum = last
        ? String(Number(last.number) + 1).padStart(6, '0')
        : '000001'

      const invoice = await prisma.invoice.create({
        data: { ...body, number: nextNum, userId: sub, status: 'PENDING' },
      })

      try {
        const result  = await invoiceService.emitir(invoice)
        const updated = await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            status:     'AUTHORIZED',
            externalId: result.externalId,
            xmlUrl:     result.xmlUrl,
            pdfUrl:     result.pdfUrl,
            issuedAt:   new Date(),
          },
        })
        return reply.status(201).send(updated)
      } catch {
        return reply.status(201).send(invoice)
      }
    },
  )

  // GET /api/invoices/:id
  server.get<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const invoice = await prisma.invoice.findFirst({
        where: { id, userId: sub },
        include: { customer: true, order: true },
      })
      if (!invoice) return reply.status(404).send({ error: 'Nota não encontrada' })

      return reply.send(invoice)
    },
  )

  // POST /api/invoices/:id/cancel
  server.post<IdParam>(
    '/:id/cancel',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const invoice = await prisma.invoice.findFirst({ where: { id, userId: sub } })
      if (!invoice) return reply.status(404).send({ error: 'Nota não encontrada' })

      if (invoice.status !== 'AUTHORIZED') {
        return reply.status(400).send({ error: 'Apenas notas autorizadas podem ser canceladas' })
      }

      const updated = await prisma.invoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
      })

      return reply.send(updated)
    },
  )
}
