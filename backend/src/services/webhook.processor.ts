import { prisma } from '../lib/prisma'
import type { WebhookEvent } from '@prisma/client'

// ─── Mapeamento de status ─────────────────────────────────────────────────────

const SHOPIFY_STATUS: Record<string, string> = {
  pending: 'PENDING', paid: 'PAID', fulfilled: 'SHIPPED',
  delivered: 'DELIVERED', refunded: 'REFUNDED', cancelled: 'CANCELLED',
}

const SHOPEE_STATUS: Record<number, string> = {
  111: 'PENDING',
  112: 'PROCESSING',
  113: 'PROCESSING',
  114: 'PROCESSING',
  120: 'SHIPPED',
  130: 'DELIVERED',
  140: 'CANCELLED',
  150: 'REFUNDED',
}

const SHOPEE_STATUS_TEXT: Record<string, string> = {
  confirmed: 'PAID',
  payment_required: 'PENDING',
  payment_in_process: 'PENDING',
  partially_refunded: 'REFUNDED',
  refunded: 'REFUNDED',
  cancelled: 'CANCELLED',
  delivered: 'DELIVERED',
}

// ─── Processor ────────────────────────────────────────────────────────────────

export const webhookProcessor = {

  async process(event: WebhookEvent): Promise<void> {
    try {
      switch (event.platform) {
        case 'SHOPIFY':      await this.processShopify(event); break
        case 'SHOPEE':       await this.processShopee(event); break
        case 'MERCADO_LIVRE': await this.processML(event); break
        case 'AMAZON':       await this.processAmazon(event); break
        default:
          await this.markIgnored(event.id, 'Plataforma não suportada')
          return
      }

      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      })
    } catch (err: any) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'FAILED', error: err?.message ?? 'Unknown error' },
      })
    }
  },

  // ─── Shopify ──────────────────────────────────────────────────────────────

  async processShopify(event: WebhookEvent) {
    const payload = event.payload as Record<string, any>

    if (event.eventType === 'orders/create' || event.eventType === 'orders/updated') {
      const status = SHOPIFY_STATUS[payload.financial_status] ?? 'PENDING'
      const items = (payload.line_items ?? []).map((i: any) => ({
        name: i.name, sku: i.sku, quantity: i.quantity,
        price: parseFloat(i.price), total: parseFloat(i.price) * i.quantity,
      }))
      const total = parseFloat(payload.total_price ?? '0')

      // Upsert cliente
      const email = payload.email
      let customer = email
        ? await prisma.customer.findFirst({ where: { email, userId: { not: '' } } })
        : null

      if (!customer && email) {
        const store = await prisma.store.findUnique({ where: { id: event.storeId } })
        if (store) {
          customer = await prisma.customer.create({
            data: {
              name: `${payload.billing_address?.first_name ?? ''} ${payload.billing_address?.last_name ?? ''}`.trim() || email,
              email,
              userId: store.userId,
            },
          })
        }
      }

      // Upsert pedido
      await prisma.order.upsert({
        where: { externalId_storeId: { externalId: String(payload.id), storeId: event.storeId } } as any,
        create: {
          externalId: String(payload.id), storeId: event.storeId,
          customerId: customer?.id, status: status as any,
          total, items,
        },
        update: { status: status as any, total, updatedAt: new Date() },
      })

      // Atualiza métrica da loja
      await this.updateStoreMetric(event.storeId)
    }

    if (event.eventType === 'orders/cancelled') {
      await prisma.order.updateMany({
        where: { externalId: String(payload.id), storeId: event.storeId },
        data: { status: 'CANCELLED' },
      })
    }
  },

  // ─── Shopee ───────────────────────────────────────────────────────────────

  async processShopee(event: WebhookEvent) {
    const payload = event.payload as Record<string, any>
    const code = Number(payload.code)

    if ([111, 112, 113, 114, 120, 130, 140, 150].includes(code)) {
      const status = SHOPEE_STATUS[code] ?? 'PENDING'
      const ordersn = payload.data?.ordersn ?? payload.ordersn

      if (ordersn) {
        const existing = await prisma.order.findFirst({
          where: { externalId: String(ordersn), storeId: event.storeId },
        })

        if (existing) {
          await prisma.order.update({
            where: { id: existing.id },
            data: { status: status as any },
          })
        } else {
          await prisma.order.create({
            data: {
              externalId: String(ordersn),
              storeId: event.storeId,
              status: status as any,
              total: Number(payload.data?.total_amount ?? 0),
              items: payload.data?.item_list ?? [],
            },
          })
        }

        await this.updateStoreMetric(event.storeId)
      }
    }
  },

  // ─── Mercado Livre ────────────────────────────────────────────────────────

  async processML(event: WebhookEvent) {
    const payload = event.payload as Record<string, any>

    if (event.eventType === 'orders' || event.eventType === 'shipments') {
      const resource = payload.resource as string
      const orderId = resource?.split('/').pop()

      if (orderId) {
        await prisma.order.upsert({
          where: { externalId_storeId: { externalId: orderId, storeId: event.storeId } } as any,
          create: {
            externalId: orderId, storeId: event.storeId,
            status: 'PENDING', total: 0, items: [],
          },
          update: { updatedAt: new Date() },
        })
        await this.updateStoreMetric(event.storeId)
      }
    }
  },

  // ─── Amazon ───────────────────────────────────────────────────────────────

  async processAmazon(event: WebhookEvent) {
    const payload = event.payload as Record<string, any>
    const notificationType = payload.NotificationType as string

    if (notificationType === 'ORDER_STATUS_CHANGE') {
      const orderId = payload.Payload?.OrderStatusChangeNotification?.AmazonOrderId
      const status = payload.Payload?.OrderStatusChangeNotification?.DestinationOrderStatus

      if (orderId) {
        const statusMap: Record<string, string> = {
          Unshipped: 'PAID', Shipped: 'SHIPPED', Delivered: 'DELIVERED', Canceled: 'CANCELLED',
        }
        await prisma.order.upsert({
          where: { externalId_storeId: { externalId: orderId, storeId: event.storeId } } as any,
          create: {
            externalId: orderId, storeId: event.storeId,
            status: (statusMap[status] ?? 'PENDING') as any,
            total: 0, items: [],
          },
          update: { status: (statusMap[status] ?? 'PENDING') as any },
        })
        await this.updateStoreMetric(event.storeId)
      }
    }
  },

  // ─── Helpers ──────────────────────────────────────────────────────────────

  async updateStoreMetric(storeId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        createdAt: { gte: today },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { total: true },
    })

    const revenue = orders.reduce((s, o) => s + o.total, 0)
    const count = orders.length
    const avgTicket = count > 0 ? revenue / count : 0

    // Upsert métrica do dia
    const existing = await prisma.storeMetric.findFirst({ where: { storeId, date: { gte: today } } })
    if (existing) {
      await prisma.storeMetric.update({
        where: { id: existing.id },
        data: { revenue, orders: count, avgTicket },
      })
    } else {
      await prisma.storeMetric.create({
        data: { storeId, revenue, orders: count, avgTicket, date: today },
      })
    }
  },

  async markIgnored(id: string, reason: string) {
    await prisma.webhookEvent.update({
      where: { id },
      data: { status: 'IGNORED', error: reason, processedAt: new Date() },
    })
  },
}
