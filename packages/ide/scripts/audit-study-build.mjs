/**
 * Auditoria da build de coleta (`ng build --configuration study`).
 *
 * Verifica no artefacto, não no fonte: a build de coleta é a que os estudantes usam, e a
 * afirmação do TCLE é sobre ela. Falha com código 1 se encontrar qualquer destino de
 * terceiro, para a verificação não depender de alguém se lembrar de a correr.
 *
 * Sobre o `gtag`: a literal aparece no pacote mesmo com a flag desligada, porque o código
 * do `ngx-google-analytics` entra no bundle e só o ramo que o ativa é que não corre. O que
 * se verifica, por isso, é o que torna um pedido possível — uma propriedade `G-…` e o
 * script remoto — e não a presença da palavra.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(raiz, "dist");

/**
 * Extensões que o navegador busca e executa. `.map` fica de fora: não é servido.
 */
const CARREGAVEIS = /\.(html|js|mjs|css|webmanifest)$/;

const PROIBIDO = [
  {
    nome: "aviso de navegador antigo, de terceiro",
    padrao: /browser-update/,
    porque: "script de terceiro com acesso total ao DOM; removido em index.study.html",
  },
  {
    nome: "badge do img.shields.io",
    padrao: /img\.shields\.io/,
    porque: "pedido a terceiro ao abrir o diálogo Sobre; substituído por link textual",
  },
  {
    nome: "propriedade do Google Analytics",
    padrao: /G-[A-Z0-9]{8,}/,
    porque: "sem id não há pedido a googletagmanager.com; enableAnalytics=false e measurementId omitido",
  },
  {
    nome: "script externo no index.html",
    padrao: /<script[^>]+src=["']https?:\/\//,
    porque: "o index da build de coleta não carrega nada de fora",
    apenas: /index\.html$/,
  },
];

function ficheiros(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      saida.push(...ficheiros(caminho));
    } else if (CARREGAVEIS.test(nome)) {
      // Só o que o navegador busca e executa. Um README de fonte empacotado em assets
      // pode citar qualquer domínio sem que a página lhe faça um pedido.
      saida.push(caminho);
    }
  }
  return saida;
}

/**
 * Devolve o código de saída: 0 limpa, 1 com achados ou sem build.
 */
function auditar() {
  let listados;
  try {
    listados = ficheiros(dist);
  } catch {
    console.error(`auditoria: ${path.relative(raiz, dist)} não existe — corra a build antes.`);
    return 1;
  }

  const achados = [];
  for (const caminho of listados) {
    const rel = path.relative(dist, caminho);
    let texto;
    try {
      texto = readFileSync(caminho, "utf8");
    } catch {
      continue;
    }
    for (const regra of PROIBIDO) {
      if (regra.apenas && !regra.apenas.test(rel)) {
        continue;
      }
      const encontrado = texto.match(regra.padrao);
      if (encontrado) {
        achados.push({ rel, regra, amostra: encontrado[0] });
      }
    }
  }

  if (achados.length > 0) {
    console.error("auditoria da build de coleta: FALHOU\n");
    for (const { rel, regra, amostra } of achados) {
      console.error(`  ${rel}`);
      console.error(`    ${regra.nome}: ${amostra}`);
      console.error(`    ${regra.porque}\n`);
    }
    return 1;
  }

  console.log(`auditoria da build de coleta: limpa (${listados.length} ficheiros, ${PROIBIDO.length} regras)`);
  return 0;
}

process.exitCode = auditar();
