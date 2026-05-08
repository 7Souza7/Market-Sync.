/// <reference types="node" />
import { PrismaClient } from '@prisma/client'

// eslint-disable-next-line no-var
declare global { var __prisma: PrismaClient | undefined }

export const prisma: PrismaClient =
  globalThis.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? (['query', 'error', 'warn'] as const)
      : (['error'] as const),
  })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma
}
