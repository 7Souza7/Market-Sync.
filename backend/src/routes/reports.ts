import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { pdfService } from '../services/pdf.service'
import dayjs from 'dayjs'

const reportSchema = z.object({
  type:   z.enum(['dashboard', 'ads', 'finance', 'crm', 'full']),
  period: z.string().optional(),
  title:  z.string().optional(),
})

type ReportBody = z.infer<typeof reportSchema>

export async function pdfRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // POST /api/reports/generate
  server.post<{ Body: ReportBody }>(
    '/generate',
    { preHandler },
    async (request: FastifyRequest<{ Body: ReportBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body    = reportSchema.parse(request.body)

      const month = body.period ?? dayjs().format('YYYY-MM')
      const start = dayjs(month).startOf('month').toDate()
      const end   = dayjs(month).endOf('month').toDate()

      const user = await prisma.user.findUnique({
        where:  { id: sub },
        select: { name: true, email: true },
      })

      const data: Record<string, unknown> = {
        user,
        period:      month,
        generatedAt: new Date().toISOString(),
      }

      if (['dashboard', 'full'].includes(body.type)) {
        const [orders, customers, stores] = await Promise.all([
          prisma.order.aggregate({
            where: { store: { userId: sub }, createdAt: { gte: start, lte: end } },
            _sum: { total: true }, _count: true,
          }),
          prisma.customer.count({ where: { userId: sub } }),
          prisma.store.findMany({
            where:  { userId: sub, isActive: true },
            select: { name: true, platform: true },
          }),
        ])
        data.overview = { revenue: orders._sum.total ?? 0, orders: orders._count, customers, stores }
      }

      if (['ads', 'full'].includes(body.type)) {
        data.ads = await prisma.ad.findMany({
          where:   { userId: sub },
          select:  { name: true, platform: true, status: true, spent: true, revenue: true, roas: true, impressions: true, clicks: true, ctr: true },
          orderBy: { revenue: 'desc' },
          take:    20,
        })
      }

      if (['finance', 'full'].includes(body.type)) {
        const [income, expense, txs] = await Promise.all([
          prisma.transaction.aggregate({ where: { type: 'INCOME', date: { gte: start, lte: end } }, _sum: { amount: true } }),
          prisma.transaction.aggregate({ where: { type: 'EXPENSE', date: { gte: start, lte: end } }, _sum: { amount: true } }),
          prisma.transaction.findMany({ where: { date: { gte: start, lte: end } }, orderBy: { date: 'desc' }, take: 50 }),
        ])
        data.finance = { income: income._sum.amount ?? 0, expense: expense._sum.amount ?? 0, transactions: txs }
      }

      if (['crm', 'full'].includes(body.type)) {
        data.customers = await prisma.customer.findMany({
          where:   { userId: sub },
          orderBy: { totalSpent: 'desc' },
          take:    30,
          select:  { name: true, email: true, segment: true, totalSpent: true, orderCount: true },
        })
      }

      const title     = body.title ?? `Relatório ${body.type} — ${dayjs(month).format('MMMM YYYY')}`
      const pdfBuffer = await pdfService.generate({ title, type: body.type, data })

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="erp-report-${body.type}-${month}.pdf"`)
      return reply.send(pdfBuffer)
    },
  )

  // GET /api/reports
  server.get(
    '/',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      const reports = await prisma.pdfReport.findMany({
        where:   { userId: sub },
        orderBy: { createdAt: 'desc' },
        take:    20,
      })

      return reply.send(reports)
    },
  )
}
