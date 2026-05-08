/// <reference types="node" />
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '../lib/prisma'

function getAnthropic() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) }

const SYSTEM_PROMPT = `Você é um especialista em marketing digital e e-commerce integrado ao ERP Pro.
Você ajuda a criar anúncios, copys persuasivos, headlines, descrições de produtos,
pesquisas de mercado, análises de performance e estratégias de escala.
Responda sempre em português brasileiro, de forma objetiva e prática.
Quando criar copys, apresente diferentes variações (A/B).
Quando analisar dados, dê insights acionáveis.`

const messageSchema = z.object({
  message: z.string().min(1),
  chatId:  z.string().optional(),
  context: z.object({
    type: z.enum(['ad_creation', 'market_research', 'copy', 'analysis', 'general']),
    data: z.record(z.unknown()).optional(),
  }).optional(),
})

const generateAdSchema = z.object({
  product:   z.string(),
  platform:  z.string(),
  objective: z.string().optional(),
  audience:  z.string().optional(),
})

type MessageBody   = z.infer<typeof messageSchema>
type GenerateAdBody = z.infer<typeof generateAdSchema>
type ChatsQuery    = { Querystring: { limit?: string } }

export async function aiRoutes(server: FastifyInstance) {
  const preHandler = [server.authenticate]

  // POST /api/ai/chat — SSE streaming
  server.post<{ Body: MessageBody }>(
    '/chat',
    { preHandler },
    async (request: FastifyRequest<{ Body: MessageBody }>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const body    = messageSchema.parse(request.body)

      let chat = body.chatId
        ? await prisma.aiChat.findFirst({ where: { id: body.chatId, userId: sub } })
        : null

      if (!chat) {
        chat = await prisma.aiChat.create({ data: { userId: sub, messages: [] } })
      }

      const history = (chat.messages as Array<{ role: string; content: string }>) ?? []

      const contextNote = body.context
        ? `\n[Contexto: ${body.context.type}${body.context.data ? ' | Dados: ' + JSON.stringify(body.context.data) : ''}]`
        : ''

      history.push({ role: 'user', content: body.message + contextNote })

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')

      let fullResponse = ''

      const stream = await getAnthropic().messages.stream({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system:     SYSTEM_PROMPT,
        messages:   history.map(m => ({
          role:    m.role as 'user' | 'assistant',
          content: m.content,
        })),
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          fullResponse += chunk.delta.text
          reply.raw.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
        }
      }

      history.push({ role: 'assistant', content: fullResponse })
      await prisma.aiChat.update({
        where: { id: chat.id },
        data:  { messages: history },
      })

      reply.raw.write(`data: ${JSON.stringify({ done: true, chatId: chat.id })}\n\n`)
      reply.raw.end()
    },
  )

  // POST /api/ai/generate-ad
  server.post<{ Body: GenerateAdBody }>(
    '/generate-ad',
    { preHandler },
    async (request: FastifyRequest<{ Body: GenerateAdBody }>, reply: FastifyReply) => {
      const body = generateAdSchema.parse(request.body)

      const response = await getAnthropic().messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system:     SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: `Crie um anúncio completo para ${body.platform} para o produto: "${body.product}".
Objetivo: ${body.objective ?? 'Conversão/Venda'}
Público: ${body.audience ?? 'Geral'}

Retorne APENAS JSON neste formato:
{
  "headline": "título principal",
  "description": "texto do anúncio",
  "cta": "texto do botão",
  "variations": [
    { "headline": "variação 1", "description": "..." },
    { "headline": "variação 2", "description": "..." }
  ],
  "imagePrompt": "prompt em inglês para gerar imagem no DALL-E",
  "targetingTips": ["dica 1", "dica 2"]
}`,
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const json = JSON.parse(text.replace(/```json|```/g, '').trim())

      return reply.send(json)
    },
  )

  // GET /api/ai/chats
  server.get<ChatsQuery>(
    '/chats',
    { preHandler },
    async (request: FastifyRequest<ChatsQuery>, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }
      const { limit } = request.query

      const chats = await prisma.aiChat.findMany({
        where:   { userId: sub },
        select:  { id: true, title: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take:    Number(limit ?? 20),
      })

      return reply.send(chats)
    },
  )
}
