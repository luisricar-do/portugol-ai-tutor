#!/usr/bin/env node
/**
 * Gera environment.version.ts com commit e data de build (antes de ng build), e
 * environment.build.ts com a URL do serviço do tutor (`AGENT_API_BASE_URL`; na esteira,
 * a variable homónima do repositório).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const outPath = path.join(import.meta.dirname, "../src/environments/environment.version.ts");

let commitSha;
try {
  commitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  commitSha = process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";
}

const buildDate = new Date().toLocaleString("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
});

const contents = `// Gerado por scripts/inject-version.mjs — não editar manualmente.
export const buildVersion = {
  commitSha: ${JSON.stringify(commitSha)},
  buildDate: ${JSON.stringify(buildDate)},
};
`;

writeFileSync(outPath, contents, "utf8");
console.log(`Wrote ${outPath} (${commitSha})`);

const buildPath = path.join(import.meta.dirname, "../src/environments/environment.build.ts");
const agentApiBaseUrl = (process.env.AGENT_API_BASE_URL ?? "").trim();

const buildContents = `// Gerado por scripts/inject-version.mjs a partir de AGENT_API_BASE_URL — não editar manualmente.
export const buildConfig = {
  agentApiBaseUrl: ${JSON.stringify(agentApiBaseUrl)},
};
`;

writeFileSync(buildPath, buildContents, "utf8");
console.log(`Wrote ${buildPath} (agentApiBaseUrl: ${agentApiBaseUrl || "vazia"})`);
