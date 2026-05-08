/// <reference types="node" />
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import OpenAI from 'openai'
import { prisma } from '../lib/prisma'

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' }) }

const PLATFORM_TIPS: Record<string, string> = {
  META:    'clean bright background, lifestyle photo style, Instagram-ready, no text, photorealistic',
  GOOGLE:  'white background product shot, clear subject, professional product photography',
  TIKTOK:  'vibrant colors, dynamic composition, eye-catching, young target audience, trending aesthetic',
  KWAI:    'vibrant, colorful, high contrast, social media ready',
  DEFAULT: 'professional product photography, clean background, commercial quality',
}

const generateSchema = z.object({
  prompt:   z.string().min(1),
  style:    z.enum(['vivid', 'natural']).default('vivid'),
  size:     z.enum(['1024x1024', '1792x1024', '1024x1792']).default('1024x1024'),
  format:   z.enum(['url', 'b64_json']).default('url'),
  adId:     z.string().optional(),
  product:  z.string().optional(),
  platform: z.string().optional(),
})

const variationsSchema = z.object({
  product:  z.string(),
  platform: z.string().default('META'),
  style:    z.enum(['vivid', 'natural']).default('vivid'),
})

type GenerateBody    = z.infer<typeof generateSchema>
type VariationsBody  = z.infer<typeof variationsSchema>
type IdParam         = { Params: { id: string } }
type ListQuery       = { Querystring: { adId?: string; limit?: string } }

export async function imageRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // POST /api/images/generate
  server.post<{ Body: GenerateBody }>(
    '/generate',
    { preHandler },
    async (request: FastifyRequest<{ Body: GenerateBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      if (!process.env.OPENAI_API_KEY) {
        return reply.status(503).send({
          error: 'OPENAI_API_KEY não configurada. Adicione ao .env para usar geração de imagens.',
        })
      }

      const body = generateSchema.parse(request.body)

      let finalPrompt = body.prompt
      if (body.product) {
        const tip = PLATFORM_TIPS[body.platform?.toUpperCase() ?? 'DEFAULT'] ?? PLATFORM_TIPS.DEFAULT
        finalPrompt = `Product advertisement photo for "${body.product}". ${body.prompt}. ${tip}. High quality, 4K resolution.`
      }

      try {
        const response = await getOpenAI().images.generate({
          model:           'dall-e-3',
          prompt:          finalPrompt,
          n:               1,
          size:            body.size,
          quality:         'hd',
          style:           body.style,
          response_format: body.format,
        })

        const image = response.data?.[0] as any

        const imageUrl = image.url ?? ''
        const revisedPrompt = image.revised_prompt ?? finalPrompt


        const saved = await prisma.generatedImage.create({
          data: {
            prompt:  finalPrompt,
            url:     imageUrl,
            model:   'dall-e-3',
            size:    body.size,
            style:   body.style,
            adId:    body.adId,
            userId:  sub,
          },
        })

        return reply.send({
          id:             saved.id,
          url:            imageUrl,
          revisedPrompt,
          size:           body.size,
          style:          body.style,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro ao gerar imagem'
        return reply.status(500).send({ error: msg })
      }
    },
  )

  // POST /api/images/generate-variations
  server.post<{ Body: VariationsBody }>(
    '/generate-variations',
    { preHandler },
    async (request: FastifyRequest<{ Body: VariationsBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      if (!process.env.OPENAI_API_KEY) {
        return reply.status(503).send({ error: 'OPENAI_API_KEY não configurada' })
      }

      const body = variationsSchema.parse(request.body)
      const tip  = PLATFORM_TIPS[body.platform.toUpperCase()] ?? PLATFORM_TIPS.DEFAULT

      const prompts = [
        `${body.product} product photo with lifestyle scene, natural light, ${tip}`,
        `${body.product} minimalist product shot on white background, studio lighting, ${tip}`,
        `${body.product} close-up detail shot, shallow depth of field, ${tip}`,
        `${body.product} flat lay composition with complementary props, top-down view, ${tip}`,
      ]

      const settled = await Promise.allSettled(
        prompts.map(p =>
          getOpenAI().images.generate({
            model: 'dall-e-3', prompt: p, n: 1,
            size: '1024x1024', quality: 'hd', style: body.style,
          }),
        ),
      )

      const images = []
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i]
        if (r.status === 'fulfilled') {
          const url = (r.value as any).data?.[0]?.url ?? ''
          const saved = await prisma.generatedImage.create({
            data: { prompt: prompts[i], url, model: 'dall-e-3', size: '1024x1024', style: body.style, userId: sub },
          })
          images.push({ id: saved.id, url, prompt: prompts[i], variant: i + 1 })
        }
      }

      return reply.send({ images, total: images.length })
    },
  )

  // GET /api/images
  server.get<ListQuery>(
    '/',
    { preHandler },
    async (request: FastifyRequest<ListQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const { adId, limit } = request.query

      const images = await prisma.generatedImage.findMany({
        where:   { userId: sub, ...(adId ? { adId } : {}) },
        orderBy: { createdAt: 'desc' },
        take:    Number(limit ?? 20),
      })

      return reply.send(images)
    },
  )

  // DELETE /api/images/:id
  server.delete<IdParam>(
    '/:id',
    { preHandler },
    async (request: FastifyRequest<IdParam>, reply: FastifyReply) => {
      const { id }  = request.params
      const { sub } = request.user as { sub: string }

      const img = await prisma.generatedImage.findFirst({ where: { id, userId: sub } })
      if (!img) return reply.status(404).send({ error: 'Imagem não encontrada' })

      await prisma.generatedImage.delete({ where: { id } })
      return reply.status(204).send()
    },
  )
}
