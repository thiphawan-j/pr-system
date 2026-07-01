import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

declare global {
  var prismaClientSingleton: PrismaClient | undefined;
  var prismaPoolSingleton: Pool | undefined;
  var prismaAdapterSingleton: PrismaPg | undefined;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable");
  }

  return databaseUrl;
}

function getAdapter() {
  if (!globalThis.prismaPoolSingleton) {
    globalThis.prismaPoolSingleton = new Pool({
      connectionString: getDatabaseUrl(),
    });
    globalThis.prismaAdapterSingleton = new PrismaPg(globalThis.prismaPoolSingleton);
  }

  return globalThis.prismaAdapterSingleton;
}

export function getDb() {
  if (!globalThis.prismaClientSingleton) {
    globalThis.prismaClientSingleton = new PrismaClient({
      adapter: getAdapter(),
    });
  }

  return globalThis.prismaClientSingleton;
}
