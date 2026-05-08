import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'

const registerSchema = z.object({
  name:     z.string().min(2),
  email:    z.string().email(),
  password: z.string().min(6),
})

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

type RegisterBody = z.infer<typeof registerSchema>
type LoginBody    = z.infer<typeof loginSchema>

export async function authRoutes(server: FastifyInstance): Promise<void> {

  // POST /api/auth/register
  server.post<{ Body: RegisterBody }>(
    '/register',
    async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      const body = registerSchema.parse(request.body)

      const exists = await prisma.user.findUnique({ where: { email: body.email } })
      if (exists) return reply.status(400).send({ error: 'Email já cadastrado' })

      const hash = await bcrypt.hash(body.password, 10)
      const user = await prisma.user.create({
        data:   { name: body.name, email: body.email, password: hash },
        select: { id: true, name: true, email: true, role: true },
      })

      const token = server.jwt.sign({ sub: user.id, role: user.role })
      return reply.status(201).send({ token, user })
    },
  )

  // POST /api/auth/login
  server.post<{ Body: LoginBody }>(
    '/login',
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const body = loginSchema.parse(request.body)

      const user = await prisma.user.findUnique({ where: { email: body.email } })
      if (!user) return reply.status(401).send({ error: 'Credenciais inválidas' })

      const valid = await bcrypt.compare(body.password, user.password)
      if (!valid) return reply.status(401).send({ error: 'Credenciais inválidas' })

      const token = server.jwt.sign({ sub: user.id, role: user.role })
      return reply.send({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      })
    },
  )

  // GET /api/auth/me
  server.get(
    '/me',
    { preHandler: [server.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sub } = request.user as { sub: string }

      const user = await prisma.user.findUniqueOrThrow({
        where:  { id: sub },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      })

      return reply.send(user)
    },
  )
}
