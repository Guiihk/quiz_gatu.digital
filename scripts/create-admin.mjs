import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createAdmin, hasAdmin } from "../src/lib/local-store.ts";

async function readPassword() {
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").replace(/\r?\n$/, "");

  const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  process.stderr.write("Senha do administrador (mínimo de 12 caracteres): ");
  try {
    return await prompt.question("", { signal: AbortSignal.timeout(120_000) });
  } finally {
    prompt.close();
    process.stderr.write("\n");
  }
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (process.argv.length !== 3 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Uso: node scripts/create-admin.mjs email@empresa.com");
  }
  if (hasAdmin()) throw new Error("Já existe um administrador neste banco.");

  const password = await readPassword();
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) {
    throw new Error("Use uma senha de 12 a 128 caracteres, em uma única linha.");
  }
  if (!(await createAdmin(email, password))) throw new Error("Já existe um administrador neste banco.");
  process.stdout.write("Administrador criado. Use o e-mail e a senha no painel.\n");
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
