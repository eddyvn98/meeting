/**
 * lib/prisma.ts
 *
 * Shared Prisma Client singleton.
 *
 * Next.js dev mode hot-reloads route modules on every request, which would
 * otherwise instantiate a brand-new PrismaClient (and a brand-new DB
 * connection pool) each time. Stashing the instance on `globalThis` survives
 * module reloads in dev while staying a plain singleton in production.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
