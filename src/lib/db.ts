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
  // Na Vercel cada instância abre o próprio pool. Pool pequeno e que solta rápido.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: urlDeExecucao(url), max: Number(process.env.DATABASE_POOL_MAX) || 3, idleTimeoutMillis: 5_000 }),
  });
}

/**
 * O pooler do Supabase na porta 5432 (modo sessão) aceita só 15 clientes no
 * total: a tela de Prévias abre uma miniatura por modelo, cada uma numa
 * instância, e o painel caía com EMAXCONNSESSION. Para as consultas do app
 * usamos o mesmo pooler na porta 6543 (modo transação), que divide poucas
 * conexões reais entre muitos clientes. O db push do build continua na 5432.
 * DATABASE_MODO_SESSAO=1 desliga a troca.
 */
export function urlDeExecucao(url: string): string {
  if (process.env.DATABASE_MODO_SESSAO === "1") return url;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith(".pooler.supabase.com") && (u.port === "5432" || u.port === "")) {
      u.port = "6543";
      return u.toString();
    }
  } catch {
    /* URL fora do padrão: usa como veio */
  }
  return url;
}

const global = globalThis as unknown as { __db?: PrismaClient };
// Guardado no globalThis também em produção: o bundle pode carregar este
// módulo mais de uma vez, e cada cópia abriria um pool novo.
export const db = (global.__db ??= criar());

export const ehSqlite = () => (process.env.DATABASE_URL?.trim() || "file:").startsWith("file:");
