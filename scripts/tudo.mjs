#!/usr/bin/env node
/**
 * npm run tudo — sobe o sistema, o Rastro e o WhatsApp juntos, num terminal só.
 *   npm run tudo            desenvolvimento (next dev)
 *   npm run tudo -- --prod  produção (next start; rode npm run build antes)
 * Ctrl+C derruba os três.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prod = process.argv.includes("--prod");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const CORES = { sistema: "\x1b[32m", rastro: "\x1b[36m", whatsapp: "\x1b[35m" };
const filhos = [];

function subir(nome, args, cwd) {
  if (!existsSync(path.join(cwd, "node_modules"))) {
    console.log(`${CORES[nome]}[${nome}]\x1b[0m não instalado (rode npm run setup). Pulando.`);
    return;
  }
  const p = spawn(npm, args, { cwd, env: { ...process.env, FORCE_COLOR: "1" }, shell: process.platform === "win32" });
  const prefixo = `${CORES[nome]}[${nome}]\x1b[0m `;
  const escrever = (d) => process.stdout.write(String(d).split(/\r?\n/).filter(Boolean).map((l) => prefixo + l).join("\n") + "\n");
  p.stdout.on("data", escrever);
  p.stderr.on("data", escrever);
  p.on("exit", (c) => console.log(`${prefixo}saiu (${c ?? "sinal"})`));
  filhos.push(p);
}

subir("rastro", ["start"], path.join(raiz, "servicos/rastro"));
subir("whatsapp", ["start"], path.join(raiz, "servicos/whatsapp"));
subir("sistema", ["run", prod ? "start" : "dev"], raiz);

const parar = () => {
  for (const f of filhos) f.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1500);
};
process.on("SIGINT", parar);
process.on("SIGTERM", parar);
