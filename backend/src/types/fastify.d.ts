import type { FastifyRequest, FastifyReply } from 'fastify'

// Augmenta FastifyInstance com o decorator authenticate
declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>
  }

  // Augmenta request.user para incluir os campos do JWT
  interface FastifyRequest {
    user: {
      sub:  string
      role: string
      iat?: number
      exp?: number
    }
  }
}
