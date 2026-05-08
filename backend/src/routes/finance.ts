import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { TransactionType } from '@prisma/client'
import dayjs from 'dayjs'

const txSchema = z.object({
  type:        z.nativeEnum(TransactionType),
  category:    z.string().min(1),
  description: z.string().min(1),
  amount:      z.number().positive(),
  date:        z.string().datetime().optional(),
})

type TxBody    = z.infer<typeof txSchema>
type IdParam   = { Params: { id: string } }
type MonthQuery = { Querystring: { month?: string } }

export async function financeRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/finance
  server.get<MonthQuery>(
    '/',
    { preHandler },
    async (request: FastifyRequest<MonthQuery>, reply: FastifyReply) => {
      const { month } = request.query
      const start = month ? dayjs(month).startOf('month').toDate() : dayjs().startOf('month').toDate()
      const end   = dayjs(start).endOf('month').toDate()

      const txs = await prisma.transaction.findMany({
        where: { date: { gte: start, lte: end } },
        orderBy: { date: 'desc' },
      })

      return reply.send(txs)
    },
  )

  // GET /api/finance/summary
  server.get<MonthQuery>(
    '/summary',
    { preHandler },
    async (request: FastifyRequest<MonthQuery>, reply: FastifyReply) => {
      const { month } = request.query
      const start = month ? dayjs(month).startOf('month').toDate() : dayjs().startOf('month').toDate()
      const end   = dayjs(start).endOf('month').toDate()

      const [income, expense] = await Promise.all([
        prisma.transaction.aggregate({
          where: { type: 'INCOME', date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { type: 'EXPENSE', date: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
      ])

      const totalIncome  = income._sum.amount  ?? 0
      const totalExpense = expense._sum.amount ?? 0

      return reply.send({
        income:  totalIncome,
        expense: totalExpense,
        profit:  totalIncome - totalExpense,
        margin:  totalIncome > 0
          ? Math.round(((totalIncome - totalExpense) / totalIncome) * 10000) / 100
          : 0,
      })
    },
  )

  // POST /api/finance
  server.post<{ Body: TxBody }>(
    '/',
    { preHandler },
    async (request: FastifyRequest<{ Body: TxBody }>, reply: FastifyReply) => {
      const body = txSchema.parse(request.body)

      const tx = await prisma.transaction.create({
        data: { ...body, date: body.date ? new Date(body.date) : new Date() },
      })

      return reply.status(201).send(tx)
    },
  )

  // DELETE /api/finance/:id
  server.delete<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id } = request.params

      await prisma.transaction.delete({ where: { id } })
      return reply.status(204).send()
    },
  )
}
