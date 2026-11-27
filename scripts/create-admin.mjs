import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createAdmin, hasAdmin, resetAdminPassword } from "../src/lib/local-store.ts";

async function readPassword(reset) {
  if (!process.stdin.isTTY) {
    const lines = readFileSync(0, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
    if (reset && (lines.length !== 2 || lines[0] !== lines[1])) throw new Error("As senhas precisam ser iguais.");
    return reset ? lines[0] : lines.join("\n");
  }

  const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output: silentOutput, terminal: true });
  async function ask(label) {
    process.stderr.write(label);
    try {
      return await prompt.question("", { signal: AbortSignal.timeout(120_000) });
    } finally {
      process.stderr.write("\n");
    }
  }
  try {
    const password = await ask(reset ? "Nova senha (mínimo de 12 caracteres): " : "Senha do administrador (mínimo de 12 caracteres): ");
    if (password !== await ask("Repita a senha: ")) throw new Error("As senhas precisam ser iguais.");
    return password;
  } finally {
    prompt.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args[0] === "--reset-password";
  const email = args[reset ? 1 : 0]?.trim().toLowerCase();
  if (args.length !== (reset ? 2 : 1) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Uso: node scripts/create-admin.mjs [--reset-password] email@empresa.com");
  }
  const adminExists = hasAdmin();
  if (reset && !adminExists) throw new Error("Crie o administrador antes de redefinir a senha.");
  if (!reset && adminExists) throw new Error("Já existe um administrador neste banco.");

  const password = await readPassword(reset);
  if (password.length < 12 || password.length > 128 || /[\r\n]/.test(password)) {
    throw new Error("Use uma senha de 12 a 128 caracteres, em uma única linha.");
  }
  if (reset) {
    if (!(await resetAdminPassword(email, password))) throw new Error("O e-mail informado não corresponde ao administrador.");
    process.stdout.write("Senha redefinida. As sessões anteriores foram encerradas.\n");
    return;
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
