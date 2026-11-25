import "server-only";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Um cliente só, com o adaptador certo para a DATABASE_URL:
 * file:... → SQLite local; postgresql://... → Postgres (Supabase, Neon, VPS).
 */
function criar() {
  const url = process.env.DATABASE_URL?.trim() || "file:./dados/garimpo.db";
  if (url.startsWith("file:")) {
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  }
  // Na Vercel cada instância abre o próprio pool; o pooler do Supabase (modo
  // sessão) aceita poucas conexões no total. Pool pequeno e que solta rápido.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX) || 3, idleTimeoutMillis: 5_000 }),
  });
}

const global = globalThis as unknown as { __db?: PrismaClient };
// Guardado no globalThis também em produção: o bundle pode carregar este
// módulo mais de uma vez, e cada cópia abriria um pool novo.
export const db = (global.__db ??= criar());

export const ehSqlite = () => (process.env.DATABASE_URL?.trim() || "file:").startsWith("file:");
