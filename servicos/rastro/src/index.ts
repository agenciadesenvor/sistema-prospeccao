/**
 * Rastro — buscador do Google Maps do Garimpo (127.0.0.1 por padrão; RASTRO_HOST=0.0.0.0 no Docker).
 * Usa um coletor próprio (collector.ts, URL direta do Maps) com o parser e os seletores em src/maps/. Perfil do Chromium em .local/rastro-profile.
 * Uma busca por vez, pausa aleatória de 5–15 s entre buscas, máximo de 20 buscas/hora.
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { collectPlaces } from "./collector";
import { mapsBrowser } from "./maps/browser-manager";
import { MapsActionRequired, type MapsLead } from "./maps/types";

try { process.loadEnvFile(); } catch { /* sem .env: usa só o ambiente do processo */ }

const HOST = process.env.RASTRO_HOST || "127.0.0.1";
const PORT = Number(process.env.RASTRO_PORT) || 4310;
const TOKEN = process.env.RASTRO_TOKEN || "";
const SESSION_ID = "rastro";
const SEARCH_TIMEOUT_MS = 90_000;
// Túneis (Cloudflare) cortam a resposta em 100 s. A busca para de abrir lugares ~75 s depois que o pedido
// chegou (contando a espera na fila) e devolve o que já achou.
const ORCAMENTO_MS = Number(process.env.RASTRO_ORCAMENTO_MS) || 75_000;
const MAX_PER_HOUR = Number(process.env.RASTRO_LIMITE_HORA) || 20;
const MAX_RESULTS = Math.min(20, Number(process.env.RASTRO_MAX_RESULTADOS) || 20);
const MAX_BODY_BYTES = 10_000;

type Lugar = { placeId: string | null; nome: string; endereco: string | null; nota: number | null; totalAvaliacoes: number | null; site: string | null; telefone: string | null; linkMaps: string | null; categoria: string | null };

const buscarSchema = z.object({ nome: z.string().trim().min(2).max(150), cidade: z.string().trim().min(2).max(150) });
const vizinhosSchema = z.object({
  tipo: z.string().trim().min(2).max(100),
  cidade: z.string().trim().min(2).max(150),
  excluir: z.union([z.string().trim().max(500), z.array(z.string().trim().max(500)).max(20)]).optional(),
  limite: z.number().int().min(1).max(MAX_RESULTS).default(5),
});

class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: Record<string, unknown>) { super(String(body.motivo ?? status)); }
}

function toLugar(lead: MapsLead): Lugar {
  return { placeId: lead.externalId ?? null, nome: lead.companyName, endereco: lead.address ?? null, nota: lead.rating ?? null, totalAvaliacoes: lead.reviewsCount ?? null, site: lead.website ?? null, telefone: lead.phone ?? null, linkMaps: lead.mapsUrl ?? null, categoria: lead.category ?? null };
}

// ---- Limite de 20 buscas por hora (janela deslizante, conta no momento em que a busca é aceita) ----
const accepted: number[] = [];
function takeRateSlot() {
  const now = Date.now();
  while (accepted.length && accepted[0] <= now - 3_600_000) accepted.shift();
  if (accepted.length >= MAX_PER_HOUR) throw new HttpError(429, { motivo: "limite_por_hora", tenteEmSegundos: Math.ceil((accepted[0] + 3_600_000 - now) / 1000) });
  accepted.push(now);
}

// ---- Fila em memória: uma busca por vez, pausa aleatória de 5–15 s entre buscas ----
let tail: Promise<unknown> = Promise.resolve();
let lastFinishedAt = 0;
let pauseMs = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function enqueue<T>(job: (isCancelled: () => boolean) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      const wait = lastFinishedAt + pauseMs - Date.now();
      if (wait > 0) await sleep(wait);
      let cancelled = false;
      // O 504 sai na hora; a busca recebe o cancelamento e a fila continua presa até ela terminar de fato.
      const timer = setTimeout(() => { cancelled = true; reject(new HttpError(504, { motivo: "timeout" })); }, SEARCH_TIMEOUT_MS);
      try { resolve(await job(() => cancelled)); }
      catch (error) { reject(error); }
      finally {
        clearTimeout(timer);
        lastFinishedAt = Date.now();
        pauseMs = 5_000 + Math.random() * 10_000;
      }
    };
    tail = tail.then(run, run);
  });
}

async function runSearch(termo: string, cidade: string, target: number, isCancelled: () => boolean, extra: { skip?: Set<string>; deadline?: number } = {}) {
  try { return await collectPlaces({ sessionId: SESSION_ID, termo, cidade, target, isCancelled, ...extra }); }
  catch (error) {
    if (error instanceof MapsActionRequired) throw new HttpError(503, { motivo: /verificação humana/i.test(error.reason) ? "captcha" : "acao_manual", detalhe: error.reason });
    throw error;
  }
}

// ---- HTTP ----
function send(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
  res.end(payload);
}

function authorized(req: http.IncomingMessage) {
  const given = req.headers["x-rastro-token"];
  if (!TOKEN || typeof given !== "string") return false;
  const a = Buffer.from(given); const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, { motivo: "corpo_grande_demais" });
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, { motivo: "json_invalido" }); }
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, { motivo: "parametros_invalidos", erros: result.error.issues.map(i => ({ campo: i.path.join("."), mensagem: i.message })) });
  return result.data;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || "/", `http://${HOST}`);
  if (req.method === "GET" && url.pathname === "/saude") return send(res, 200, { ok: true });
  if (!authorized(req)) return send(res, 401, { motivo: "nao_autorizado" });

  const deadline = Date.now() + ORCAMENTO_MS;

  if (req.method === "POST" && url.pathname === "/buscar") {
    const { nome, cidade } = parse(buscarSchema, await readJson(req));
    takeRateSlot();
    const leads = await enqueue(isCancelled => runSearch(nome, cidade, Math.min(5, MAX_RESULTS), isCancelled, { deadline }));
    return send(res, 200, { lugares: leads.slice(0, 5).map(toLugar) });
  }

  if (req.method === "POST" && url.pathname === "/vizinhos") {
    const { tipo, cidade, excluir, limite } = parse(vizinhosSchema, await readJson(req));
    const excluded = new Set((Array.isArray(excluir) ? excluir : excluir ? [excluir] : []).filter(Boolean));
    takeRateSlot();
    // Os excluídos (por placeId ou link do Maps) são pulados na lista, sem abrir a página de cada um.
    const leads = await enqueue(isCancelled => runSearch(tipo, cidade, limite, isCancelled, { skip: excluded, deadline }));
    const lugares = leads.map(toLugar).filter(l => !(l.placeId && excluded.has(l.placeId)) && !(l.linkMaps && excluded.has(l.linkMaps))).slice(0, limite);
    return send(res, 200, { lugares });
  }

  return send(res, 404, { motivo: "rota_inexistente" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    if (error instanceof HttpError) return send(res, error.status, error.body);
    console.error("[rastro] erro na busca:", error);
    if (!res.headersSent) send(res, 500, { motivo: "erro_interno" });
  });
});
server.requestTimeout = 0; // a fila pode segurar a requisição além do padrão do Node
server.headersTimeout = 30_000;

server.listen(PORT, HOST, () => {
  console.log(`[rastro] ouvindo em http://${HOST}:${PORT}`);
  if (!TOKEN) console.warn("[rastro] RASTRO_TOKEN não definido: todas as rotas com token responderão 401.");
});

async function shutdown() {
  server.close();
  await mapsBrowser.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
