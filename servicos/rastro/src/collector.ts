/**
 * Coletor próprio do Rastro: abre direto https://www.google.com/maps/search/<busca> (sem digitar na caixa de busca)
 * e usa os selectors.ts e o parser.ts de src/maps/.
 */
import type { Page } from "playwright";
import { mapsBrowser } from "./maps/browser-manager";
import { extractVisibleBusinessData } from "./maps/parser";
import { acceptNormalConsent, actionRequiredReason, findResultsFeed, getResultCards } from "./maps/selectors";
import { MapsActionRequired, type MapsLead } from "./maps/types";

/**
 * skip: placeIds ou links do Maps que o sistema já tem; são pulados sem abrir (o id vem do próprio link).
 * deadline: hora (Date.now()) em que a busca para e devolve o que já achou, em vez de estourar o tempo.
 */
export type CollectInput = { sessionId: string; termo: string; cidade: string; target: number; isCancelled: () => boolean; skip?: Set<string>; deadline?: number };

const placeIdFromLink = (url: string) => url.match(/!1s([^!/?]+)/)?.[1];

const NOT_FOUND = /O Google Maps não encontrou|não encontrou resultados|Google Maps can't find|No results found/i;
const END_OF_LIST = /Você chegou ao fim da lista|You've reached the end of the list/i;

const pause = (page: Page, min: number, max: number) => page.waitForTimeout(min + Math.random() * (max - min));

async function checkBlocked(page: Page) {
  const reason = await actionRequiredReason(page);
  if (reason) throw new MapsActionRequired(reason);
}

/** Espera o Maps decidir: página de um lugar, lista de resultados ou "nada encontrado". */
async function waitForOutcome(page: Page, timeout = 25_000): Promise<"place" | "list" | "empty"> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (page.url().includes("/maps/place/") && await page.locator("h1").first().isVisible().catch(() => false)) return "place";
    const feed = await findResultsFeed(page);
    if (feed && await getResultCards(page, feed).count()) return "list";
    const text = await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "");
    if (NOT_FOUND.test(text)) return "empty";
    await page.waitForTimeout(500);
  }
  return "empty";
}

async function readPlace(page: Page, input: CollectInput, mapsUrl: string) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  return extractVisibleBusinessData(page, { segment: input.termo, locality: input.cidade, country: "BR", mapsUrl });
}

/** Junta links de lugares da lista, rolando o painel até ter o suficiente ou a lista acabar. */
async function collectLinks(page: Page, input: CollectInput, wanted: number) {
  const links = new Set<string>(); let stagnant = 0;
  while (links.size < wanted && !input.isCancelled()) {
    const feed = await findResultsFeed(page);
    const hrefs = await getResultCards(page, feed).evaluateAll(nodes => nodes.map(n => (n as HTMLAnchorElement).href));
    const before = links.size;
    for (const href of hrefs) if (href.includes("/maps/place/")) links.add(href.split("&")[0]);
    if (links.size >= wanted || !feed) break;
    const tail = (await feed.innerText().catch(() => "")).slice(-3_000);
    if (END_OF_LIST.test(tail)) break;
    stagnant = links.size === before ? stagnant + 1 : 0;
    if (stagnant >= 3) break;
    await feed.evaluate(el => el.scrollBy(0, Math.max(500, el.clientHeight * 0.85)));
    await pause(page, 700, 1_400);
  }
  return [...links];
}

export async function collectPlaces(input: CollectInput): Promise<MapsLead[]> {
  const started = Date.now();
  const log = (step: string) => console.log(`[rastro] ${((Date.now() - started) / 1000).toFixed(1)}s ${step}`);
  const page = await mapsBrowser.page(input.sessionId); let retain = false;
  // O parser do Reach faz getAttribute/textContent em elementos opcionais (site, categoria); sem eles, o Playwright
  // espera o timeout padrão de 30 s em cada um. Nesta aba do Rastro, o padrão cai para 4 s (navegações têm o seu próprio).
  page.setDefaultTimeout(4_000);
  log("navegador pronto");
  try {
    const query = `${input.termo} em ${input.cidade}`;
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=pt-BR`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await acceptNormalConsent(page);
    await checkBlocked(page);
    log(`busca aberta: ${page.url().slice(0, 120)}`);

    const outcome = await waitForOutcome(page);
    await checkBlocked(page);
    log(`resultado: ${outcome}`);
    if (outcome === "empty" || input.isCancelled()) return [];
    if (outcome === "place") {
      const lead = await readPlace(page, input, page.url());
      return lead ? [lead] : [];
    }

    const leads: MapsLead[] = [];
    const skip = input.skip ?? new Set<string>();
    const all = await collectLinks(page, input, input.target + skip.size);
    const links = all.filter(url => !skip.has(url) && !skip.has(placeIdFromLink(url) ?? ""));
    log(`${all.length} links na lista, ${all.length - links.length} já conhecidos`);
    for (const url of links) {
      if (leads.length >= input.target || input.isCancelled()) break;
      if (input.deadline && Date.now() > input.deadline) { log(`prazo atingido, devolvendo ${leads.length}`); break; }
      await pause(page, 800, 2_000);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
      await checkBlocked(page);
      const lead = await readPlace(page, input, url);
      if (lead) leads.push(lead);
      log(`lugar ${leads.length}: ${lead?.companyName ?? "(sem título)"}`);
    }
    return leads;
  } catch (error) {
    if (error instanceof MapsActionRequired) retain = true;
    throw error;
  } finally { await mapsBrowser.release(input.sessionId, page, retain); }
}
