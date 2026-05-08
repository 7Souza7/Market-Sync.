import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import axios from 'axios'
import { prisma } from '../lib/prisma'

const META_BASE = 'https://graph.facebook.com/v20.0'

function metaClient(accessToken: string) {
  return axios.create({ baseURL: META_BASE, params: { access_token: accessToken } })
}

const campaignSchema = z.object({
  accountId:    z.string(),
  campaignName: z.string(),
  objective:    z.enum(['OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_LEADS', 'OUTCOME_AWARENESS']).default('OUTCOME_SALES'),
  budget:       z.number().positive(),
  budgetType:   z.enum(['daily', 'lifetime']).default('daily'),
  startTime:    z.string().optional(),
  endTime:      z.string().optional(),
  adsetName:    z.string(),
  targeting: z.object({
    age_min:       z.number().default(18),
    age_max:       z.number().default(65),
    genders:       z.array(z.number()).default([]),
    geo_locations: z.object({ countries: z.array(z.string()).default(['BR']) }).default({}),
    interests:     z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  }),
  creative: z.object({
    headline:      z.string(),
    body:          z.string(),
    callToAction:  z.enum(['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'BOOK_NOW']).default('SHOP_NOW'),
    linkUrl:       z.string().url(),
    imageUrl:      z.string().url().optional(),
    pageId:        z.string(),
  }),
})

type CampaignBody      = z.infer<typeof campaignSchema>
type CampaignIdParam   = { Params: { campaignId: string } }
type StatusBody        = { Body: { accountId: string; status: 'ACTIVE' | 'PAUSED' } }
type InterestsQuery    = { Querystring: { accountId: string; q: string } }
type InsightsQuery     = { Params: { accountId: string }; Querystring: { datePreset?: string } }
type CallbackQuery     = { Querystring: { code: string } }

export async function metaAdsRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // GET /api/meta/auth-url
  server.get(
    '/auth-url',
    { preHandler },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const redirectUri = encodeURIComponent(`${process.env.FRONTEND_URL}/meta/callback`)
      const scope       = encodeURIComponent('ads_management,ads_read,business_management,pages_read_engagement')
      return reply.send({
        url: `https://www.facebook.com/v20.0/dialog/oauth?client_id=${process.env.META_APP_ID}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`,
      })
    },
  )

  // GET /api/meta/callback
  server.get<CallbackQuery>(
    '/callback',
    { preHandler },
    async (request: FastifyRequest<CallbackQuery>, reply: FastifyReply) => {
      const { code } = request.query
      const { sub } = request.user as { sub: string }

      if (!code) return reply.status(400).send({ error: 'Código de autorização não fornecido' })

      const { data: tokenData } = await axios.get(`${META_BASE}/oauth/access_token`, {
        params: {
          client_id:     process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri:  `${process.env.FRONTEND_URL}/meta/callback`,
          code,
        },
      })

      const client = metaClient(tokenData.access_token)
      const { data: accounts } = await client.get('/me/adaccounts', {
        params: { fields: 'id,name,currency,timezone_name,account_status' },
      })

      const active = accounts.data?.find((a: Record<string, unknown>) => a.account_status === 1)
      if (active) {
        await prisma.metaAdAccount.upsert({
          where:  { accountId: active.id as string },
          create: { userId: sub, accountId: active.id as string, accessToken: tokenData.access_token, name: active.name as string, currency: active.currency as string, timezone: active.timezone_name as string },
          update: { accessToken: tokenData.access_token, name: active.name as string },
        })
      }

      return reply.redirect(`${process.env.FRONTEND_URL}/ads?meta=connected`)
    },
  )

  // GET /api/meta/accounts
  server.get(
    '/accounts',
    { preHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const accounts   = await prisma.metaAdAccount.findMany({ where: { userId: sub } })
      return reply.send(accounts)
    },
  )

  // GET /api/meta/insights/:accountId
  server.get<InsightsQuery>(
    '/insights/:accountId',
    { preHandler },
    async (request: FastifyRequest<InsightsQuery>, reply: FastifyReply) => {
      const { accountId }           = request.params
      const { datePreset = 'last_30d' } = request.query
      const { sub } = request.user as { sub: string }

      const account = await prisma.metaAdAccount.findFirst({ where: { accountId, userId: sub } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      const client = metaClient(account.accessToken)
      const { data } = await client.get(`/${accountId}/insights`, {
        params: { fields: 'campaign_name,impressions,clicks,spend,reach,ctr,cpc,actions,action_values', date_preset: datePreset, level: 'campaign', limit: 50 },
      })

      const campaigns = (data.data ?? []).map((c: Record<string, unknown>) => ({
        name:        c.campaign_name,
        impressions: Number(c.impressions ?? 0),
        clicks:      Number(c.clicks ?? 0),
        spend:       Number(c.spend ?? 0),
        reach:       Number(c.reach ?? 0),
        ctr:         Number(c.ctr ?? 0),
        cpc:         Number(c.cpc ?? 0),
        conversions: (c.actions as Array<Record<string, unknown>> ?? []).find(a => a.action_type === 'purchase')?.value ?? 0,
        revenue:     (c.action_values as Array<Record<string, unknown>> ?? []).find(a => a.action_type === 'purchase')?.value ?? 0,
      }))

      return reply.send({ campaigns, summary: data.summary })
    },
  )

  // POST /api/meta/campaigns
  server.post<{ Body: CampaignBody }>(
    '/campaigns',
    { preHandler },
    async (request: FastifyRequest<{ Body: CampaignBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body    = campaignSchema.parse(request.body)

      const account = await prisma.metaAdAccount.findFirst({ where: { accountId: body.accountId, userId: sub } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      const client = metaClient(account.accessToken)

      try {
        const { data: campaign } = await client.post(`/${body.accountId}/campaigns`, {
          name: body.campaignName, objective: body.objective, status: 'PAUSED', special_ad_categories: [],
        })

        const adsetPayload: Record<string, unknown> = {
          name: body.adsetName, campaign_id: campaign.id, billing_event: 'IMPRESSIONS',
          optimization_goal: 'OFFSITE_CONVERSIONS', targeting: body.targeting, status: 'PAUSED',
        }

        if (body.budgetType === 'daily') {
          adsetPayload.daily_budget = String(body.budget * 100)
        } else {
          adsetPayload.lifetime_budget = String(body.budget * 100)
          if (body.startTime) adsetPayload.start_time = body.startTime
          if (body.endTime)   adsetPayload.end_time   = body.endTime
        }

        const { data: adset }    = await client.post(`/${body.accountId}/adsets`, adsetPayload)
        const { data: creative } = await client.post(`/${body.accountId}/adcreatives`, {
          name: `${body.campaignName} — Creative`,
          object_story_spec: {
            page_id: body.creative.pageId,
            link_data: {
              link: body.creative.linkUrl, message: body.creative.body,
              name: body.creative.headline,
              call_to_action: { type: body.creative.callToAction },
              ...(body.creative.imageUrl ? { picture: body.creative.imageUrl } : {}),
            },
          },
        })

        const { data: ad } = await client.post(`/${body.accountId}/ads`, {
          name: body.campaignName, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'PAUSED',
        })

        const localAd = await prisma.ad.create({
          data: { name: body.campaignName, platform: 'META', status: 'PAUSED', headline: body.creative.headline, description: body.creative.body, budget: body.budget, userId: sub, externalId: ad.id },
        })

        return reply.send({ campaignId: campaign.id, adsetId: adset.id, creativeId: creative.id, adId: ad.id, localAdId: localAd.id, status: 'PAUSED' })
      } catch (err: unknown) {
        const detail = axios.isAxiosError(err) ? err.response?.data?.error?.message : (err instanceof Error ? err.message : 'Erro desconhecido')
        return reply.status(500).send({ error: 'Erro ao criar campanha no Meta', detail })
      }
    },
  )

  // PATCH /api/meta/campaigns/:campaignId/status
  server.patch<CampaignIdParam & StatusBody>(
    '/campaigns/:campaignId/status',
    { preHandler },
    async (request: FastifyRequest<CampaignIdParam & StatusBody>, reply: FastifyReply) => {
      const { campaignId }         = request.params
      const { accountId, status }  = request.body
      const { sub } = request.user as { sub: string }

      const account = await prisma.metaAdAccount.findFirst({ where: { accountId, userId: sub } })
      if (!account) return reply.status(404).send({ error: 'Conta não encontrada' })

      const client   = metaClient(account.accessToken)
      const { data } = await client.post(`/${campaignId}`, { status })
      return reply.send(data)
    },
  )

  // GET /api/meta/targeting/interests
  server.get<InterestsQuery>(
    '/targeting/interests',
    { preHandler },
    async (request: FastifyRequest<InterestsQuery>, reply: FastifyReply) => {
      const { accountId, q } = request.query
      const { sub } = request.user as { sub: string }

      const account = await prisma.metaAdAccount.findFirst({ where: { accountId, userId: sub } })
      if (!account) return reply.send([])

      const client   = metaClient(account.accessToken)
      const { data } = await client.get('/search', { params: { type: 'adinterest', q, limit: 20 } })
      return reply.send(data.data ?? [])
    },
  )
}
