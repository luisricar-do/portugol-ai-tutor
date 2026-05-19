#!/usr/bin/env node
/**
 * Gera environment.version.ts com commit e data de build (antes de ng build).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../src/environments/environment.version.ts");

let commitSha = "dev";
try {
  commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  commitSha = process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";
}

const buildDate = new Date().toLocaleString("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

const contents = `/** Gerado por scripts/inject-version.mjs — não editar manualmente. */
export const buildVersion = {
  commitSha: ${JSON.stringify(commitSha)},
  buildDate: ${JSON.stringify(buildDate)},
};
`;

writeFileSync(outPath, contents, "utf8");
console.log(`Wrote ${outPath} (${commitSha})`);
