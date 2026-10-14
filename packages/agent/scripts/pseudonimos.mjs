#!/usr/bin/env node
/**
 * Revinculação pseudônimo ↔ matrícula, do lado do pesquisador.
 *
 * Lê matrículas (uma por linha, de um ficheiro ou da entrada padrão) e escreve CSV
 * `matricula,participantId`, com o mesmo cálculo que a IDE faz no navegador. Usar com a lista
 * da planilha cifrada; o resultado também é dado pessoal e fica com ela.
 *
 *   npm run build:agent
 *   node packages/agent/scripts/pseudonimos.mjs matriculas.txt > vinculo.csv
 */
import { readFileSync } from "node:fs";
import process from "node:process";

import { normalizeMatricula, pseudonymFromMatricula } from "../lib/index.js";

const fonte = process.argv[2];
const texto = readFileSync(fonte ?? 0, "utf8");

process.stdout.write("matricula,participantId\n");
let invalidas = 0;
for (const linha of texto.split(/\r?\n/)) {
  if (!linha.trim()) {
    continue;
  }
  const matricula = normalizeMatricula(linha);
  if (matricula === undefined) {
    invalidas++;
    process.stderr.write(`Ignorada (não parece matrícula): ${linha.trim()}\n`);
    continue;
  }
  process.stdout.write(`${matricula},${await pseudonymFromMatricula(matricula)}\n`);
}

if (invalidas > 0) {
  process.exitCode = 1;
}
