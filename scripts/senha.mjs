#!/usr/bin/env node
/**
 * npm run senha — troca a senha de um usuário direto no banco.
 * Para quando você esqueceu a senha e o e-mail ainda não está configurado.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(raiz);
try { process.loadEnvFile(); } catch { /* sem .env */ }

const url = process.env.DATABASE_URL?.trim() || "file:./dados/garimpo.db";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("E-mail da conta: ")).trim().toLowerCase();
const senha = await rl.question("Senha nova (8+ caracteres): ");
rl.close();
if (senha.length < 8) {
  console.error("Senha curta demais.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = `scrypt.${salt.toString("base64url")}.${scryptSync(senha.normalize("NFKC"), salt, 64).toString("base64url")}`;

let mudou = 0;
if (url.startsWith("file:")) {
  mkdirSync("dados", { recursive: true });
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(url.replace(/^file:/, ""));
  mudou = db.prepare('UPDATE "Usuario" SET "senhaHash" = ?, "versaoSessao" = "versaoSessao" + 1 WHERE "email" = ?').run(hash, email).changes;
} else {
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  mudou = (await c.query('UPDATE "Usuario" SET "senhaHash" = $1, "versaoSessao" = "versaoSessao" + 1 WHERE "email" = $2', [hash, email])).rowCount ?? 0;
  await c.end();
}
console.log(mudou ? "Senha trocada. Entre com a nova." : "Nenhum usuário com esse e-mail.");
