#!/usr/bin/env node
/**
 * npm run setup — prepara tudo no terminal, em qualquer sistema (Mac, Windows, Linux):
 *  1. escolhe o banco (SQLite local ou Postgres/Supabase)
 *  2. escreve o .env (segredo + tokens do Rastro e do WhatsApp)
 *  3. instala os serviços (Rastro e WhatsApp) e o Chromium do Rastro
 *  4. cria as tabelas
 * Depois: npm run tudo → abre http://localhost:3000 e termina no navegador.
 */
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(raiz);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const perguntar = async (q, padrao = "") => ((await rl.question(`${q}${padrao ? ` [${padrao}]` : ""}: `)).trim() || padrao);
const sim = async (q, padrao = true) => /^s|^y/i.test(await perguntar(`${q} (s/n)`, padrao ? "s" : "n"));
const token = () => randomBytes(24).toString("base64url");
const rodar = (cmd, cwd = raiz) => execSync(cmd, { stdio: "inherit", cwd, env: process.env });

function lerEnv(arquivo) {
  const env = {};
  if (!existsSync(arquivo)) return env;
  for (const l of readFileSync(arquivo, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
function escreverEnv(arquivo, valores, cabecalho = "") {
  const linhas = Object.entries(valores).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
  writeFileSync(arquivo, `${cabecalho}${linhas.join("\n")}\n`);
}

console.log("\n  Garimpo · instalação\n");

const atual = lerEnv(".env");

// 1. Banco
console.log("  Banco de dados:");
console.log("   1) Local, num arquivo (SQLite). Zero configuração. Bom para o seu computador ou uma VPS.");
console.log("   2) Postgres / Supabase. Obrigatório na Vercel.\n");
const opcao = await perguntar("  Escolha", atual.DATABASE_URL?.startsWith("postgres") ? "2" : "1");
let DATABASE_URL = "file:./dados/garimpo.db";
if (opcao === "2") {
  console.log("\n  Supabase: Project Settings → Database → Connection string → URI (use a porta 5432, 'session pooler' ou direta).");
  DATABASE_URL = await perguntar("  DATABASE_URL", atual.DATABASE_URL?.startsWith("postgres") ? atual.DATABASE_URL : "");
  if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    console.error("\n  Isso não parece uma URL de Postgres (postgresql://…). Rode de novo.\n");
    process.exit(1);
  }
}

// 2. .env
const APP_URL = await perguntar("\n  Endereço público (onde o sistema vai ficar)", atual.APP_URL || "http://localhost:3000");
const env = {
  DATABASE_URL,
  APP_SECRET: atual.APP_SECRET || token(),
  APP_URL,
  RASTRO_URL: atual.RASTRO_URL || "http://127.0.0.1:4310",
  RASTRO_TOKEN: atual.RASTRO_TOKEN || token(),
  WHATSAPP_URL: atual.WHATSAPP_URL || "http://127.0.0.1:4320",
  WHATSAPP_TOKEN: atual.WHATSAPP_TOKEN || token(),
};
escreverEnv(".env", env, "# Gerado pelo npm run setup. Não suba este arquivo para o GitHub.\n");
escreverEnv("servicos/rastro/.env", { RASTRO_PORT: new URL(env.RASTRO_URL).port || "4310", RASTRO_TOKEN: env.RASTRO_TOKEN, RASTRO_LIMITE_HORA: "20", RASTRO_MAX_RESULTADOS: "20", GOOGLE_MAPS_HEADLESS: lerEnv("servicos/rastro/.env").GOOGLE_MAPS_HEADLESS ?? "0" });
escreverEnv("servicos/whatsapp/.env", { WHATSAPP_PORT: new URL(env.WHATSAPP_URL).port || "4320", WHATSAPP_TOKEN: env.WHATSAPP_TOKEN, APP_URL: "http://127.0.0.1:3000" });
console.log("\n  ✓ .env escrito (e os dos serviços, com os mesmos tokens)");

// 3. Serviços
if (await sim("\n  Instalar o Rastro (busca no Google Maps, baixa o Chromium ~150 MB)?")) {
  rodar("npm install --no-audit --no-fund", path.join(raiz, "servicos/rastro"));
  rodar("npx playwright install chromium", path.join(raiz, "servicos/rastro"));
  console.log("  ✓ Rastro pronto");
}
if (await sim("  Instalar o WhatsApp por QR code (Baileys)?")) {
  rodar("npm install --no-audit --no-fund", path.join(raiz, "servicos/whatsapp"));
  console.log("  ✓ WhatsApp pronto");
}
rl.close();

// 4. Banco
process.env.DATABASE_URL = DATABASE_URL;
rodar("node scripts/db.mjs");

console.log(`
  Tudo pronto.

    npm run tudo     sobe o sistema + Rastro + WhatsApp
    npm run dev      só o sistema

  Abra ${APP_URL} e crie a sua conta.
`);
