/// <reference types="node" />
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { config } from 'dotenv'

config()

import { authRoutes }      from './routes/auth'
import { storeRoutes }     from './routes/stores'
import { adRoutes }        from './routes/ads'
import { customerRoutes }  from './routes/customers'
import { financeRoutes }   from './routes/finance'
import { invoiceRoutes }   from './routes/invoices'
import { aiRoutes }        from './routes/ai'
import { analyticsRoutes } from './routes/analytics'
import { webhookRoutes }   from './routes/webhooks'
import { imageRoutes }     from './routes/images'
import { metaAdsRoutes }   from './routes/meta-ads'
import { pdfRoutes }       from './routes/reports'
import { authMiddleware }  from './middleware/auth'


async function bootstrap(): Promise<void> {
  const server = Fastify({
    logger: {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    },
  })

  // ─── Plugins ──────────────────────────────────────────────────────────────

  await server.register(cors, {
    origin:      process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  })

  await server.register(jwt, {
    secret: process.env.JWT_SECRET ?? 'fallback-secret',
  })

  await server.register(rateLimit, {
    max:        200,
    timeWindow: '1 minute',
  })

  await server.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  })

  // ─── Decorators ───────────────────────────────────────────────────────────

  server.decorate('authenticate', authMiddleware)

  // ─── Routes ───────────────────────────────────────────────────────────────

  await server.register(authRoutes,      { prefix: '/api/auth'      })
  await server.register(storeRoutes,     { prefix: '/api/stores'    })
  await server.register(adRoutes,        { prefix: '/api/ads'       })
  await server.register(customerRoutes,  { prefix: '/api/customers' })
  await server.register(financeRoutes,   { prefix: '/api/finance'   })
  await server.register(invoiceRoutes,   { prefix: '/api/invoices'  })
  await server.register(aiRoutes,        { prefix: '/api/ai'        })
  await server.register(analyticsRoutes, { prefix: '/api/analytics' })
  await server.register(webhookRoutes,   { prefix: '/api/webhooks'  })
  await server.register(imageRoutes,     { prefix: '/api/images'    })
  await server.register(metaAdsRoutes,   { prefix: '/api/meta'      })
  await server.register(pdfRoutes,       { prefix: '/api/reports'   })

  // ─── Health ───────────────────────────────────────────────────────────────

  server.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() })
  })

  // ─── Start ────────────────────────────────────────────────────────────────

  const port = Number(process.env.PORT ?? 3001)

  try {
    await server.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

bootstrap().catch((err) => {
  console.error(err)
  process.exit(1)
})
