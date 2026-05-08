import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '../lib/prisma'
import dayjs from 'dayjs'

type PeriodQuery = { Querystring: { period?: string } }
type MonthQuery  = { Querystring: { month?: string } }

export async function analyticsRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/analytics/overview
  server.get(
    '/overview',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const start    = dayjs().startOf('month').toDate()
      const prevStart = dayjs().subtract(1, 'month').startOf('month').toDate()
      const prevEnd   = dayjs().startOf('month').toDate()

      const [orders, prevOrders, ads, customers] = await Promise.all([
        prisma.order.aggregate({
          where: { store: { userId: sub }, createdAt: { gte: start } },
          _sum: { total: true }, _count: true,
        }),
        prisma.order.aggregate({
          where: { store: { userId: sub }, createdAt: { gte: prevStart, lt: prevEnd } },
          _sum: { total: true }, _count: true,
        }),
        prisma.ad.aggregate({
          where: { userId: sub, status: 'ACTIVE' },
          _sum: { spent: true, revenue: true }, _count: true,
        }),
        prisma.customer.count({ where: { userId: sub } }),
      ])

      const revenue      = orders._sum.total      ?? 0
      const prevRevenue  = prevOrders._sum.total   ?? 0
      const revenueGrowth = prevRevenue > 0
        ? ((revenue - prevRevenue) / prevRevenue) * 100
        : 0

      const adSpent  = ads._sum.spent   ?? 0
      const adRevenue = ads._sum.revenue ?? 0
      const roas     = adSpent > 0 ? adRevenue / adSpent : 0

      return reply.send({
        revenue,
        revenueGrowth:  Math.round(revenueGrowth * 10) / 10,
        orders:         orders._count,
        ordersGrowth:   Math.round(
          prevOrders._count > 0
            ? ((orders._count - prevOrders._count) / prevOrders._count) * 100
            : 0,
        ),
        activeAds:     ads._count,
        roas:          Math.round(roas * 10) / 10,
        totalCustomers: customers,
        adSpent,
      })
    },
  )

  // GET /api/analytics/revenue-chart
  server.get<PeriodQuery>(
    '/revenue-chart',
    { preHandler },
    async (request: FastifyRequest<PeriodQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const { period } = request.query
      const days       = period === '30d' ? 30 : period === '90d' ? 90 : 7
      const start      = dayjs().subtract(days, 'day').toDate()

      const orders = await prisma.order.findMany({
        where: {
          store: { userId: sub },
          createdAt: { gte: start },
          status: { not: 'CANCELLED' },
        },
        select: { total: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })

      const byDay = new Map<string, number>()
      for (let i = 0; i < days; i++) {
        const key = dayjs().subtract(days - 1 - i, 'day').format('YYYY-MM-DD')
        byDay.set(key, 0)
      }
      for (const order of orders) {
        const key = dayjs(order.createdAt).format('YYYY-MM-DD')
        byDay.set(key, (byDay.get(key) ?? 0) + order.total)
      }

      return reply.send(
        Array.from(byDay.entries()).map(([date, revenue]) => ({ date, revenue })),
      )
    },
  )

  // GET /api/analytics/stores
  server.get(
    '/stores',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const start   = dayjs().startOf('month').toDate()

      const stores = await prisma.store.findMany({
        where: { userId: sub, isActive: true },
        include: {
          orders: {
            where: { createdAt: { gte: start }, status: { not: 'CANCELLED' } },
            select: { total: true },
          },
        },
      })

      return reply.send(
        stores.map(s => ({
          id:       s.id,
          name:     s.name,
          platform: s.platform,
          revenue:  s.orders.reduce((sum, o) => sum + o.total, 0),
          orders:   s.orders.length,
        })),
      )
    },
  )

  // GET /api/analytics/ads-performance
  server.get(
    '/ads-performance',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      const ads = await prisma.ad.findMany({
        where: { userId: sub, status: 'ACTIVE' },
        select: { platform: true, spent: true, revenue: true, clicks: true, impressions: true },
      })

      const byPlatform = new Map<string, {
        spent: number; revenue: number; clicks: number; impressions: number
      }>()

      for (const ad of ads) {
        const cur = byPlatform.get(ad.platform) ?? { spent: 0, revenue: 0, clicks: 0, impressions: 0 }
        byPlatform.set(ad.platform, {
          spent:       cur.spent       + ad.spent,
          revenue:     cur.revenue     + ad.revenue,
          clicks:      cur.clicks      + ad.clicks,
          impressions: cur.impressions + ad.impressions,
        })
      }

      return reply.send(
        Array.from(byPlatform.entries()).map(([platform, data]) => ({
          platform,
          spent:   data.spent,
          revenue: data.revenue,
          roas:    data.spent > 0 ? Math.round((data.revenue / data.spent) * 10) / 10 : 0,
          cpc:     data.clicks > 0 ? Math.round((data.spent / data.clicks) * 100) / 100 : 0,
          ctr:     data.impressions > 0
            ? Math.round((data.clicks / data.impressions) * 10000) / 100
            : 0,
        })),
      )
    },
  )
}
