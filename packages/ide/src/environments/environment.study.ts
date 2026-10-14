import { buildConfig } from "./environment.build";
import { buildVersion } from "./environment.version";

/**
 * Build de coleta: a IDE que os estudantes usam nas sessões.
 *
 * Difere da build pública no que o TCLE declara, nenhum dado sai para serviço de terceiro, e
 * em abrir já como sessão de pesquisa.
 *
 * `enableAnalytics: false` impede o `app.config.ts` de chamar
 * `NgxGoogleAnalyticsModule.forRoot`, que é o único caminho que carrega o `gtag.js`, e
 * substitui o `GoogleAnalyticsService` por um no-op, de modo que também as diretivas
 * `gaEvent` dos templates deixem de ter efeito.
 *
 * `enableShare: false` retira o botão Compartilhar e neutraliza o `ShareService`, que
 * de outro modo escreveria o programa do estudante no Firebase Storage. Com `firebase: null`
 * o `app.config.ts` nem inicializa o Firebase, e a configuração do projeto não entra no pacote.
 *
 * `enableTutorTelemetry` fica ligada: é o registo da pesquisa, e a fila envia apenas
 * para `{agentApiBaseUrl}/telemetry`, o serviço do tutor mantido pela pesquisa.
 *
 * `studyGate: true` abre a IDE com o formulário de matrícula: o estudante identifica-se ou
 * escolhe o modo teste, e só no primeiro caso a coleta começa.
 *
 * Usar com `ng build --configuration study` ou `ng serve --configuration study`.
 */
export const environment = {
  production: true,
  commitSha: buildVersion.commitSha,
  buildDate: buildVersion.buildDate,
  /**
   * Ligada: é o instrumento da pesquisa, e a fila só fala com o serviço do tutor.
   */
  enableTutorTelemetry: true,
  enableAnalytics: false,
  /**
   * Vazia de propósito: com a substituição de ficheiro, o id não chega ao pacote de coleta.
   */
  analyticsMeasurementId: "",
  /**
   * Desligado: o Compartilhar enviaria o código do estudante ao Firebase Storage.
   */
  enableShare: false,
  /**
   * Vem de `AGENT_API_BASE_URL` no build (variable do repositório na esteira); inclua `/api`.
   */
  agentApiBaseUrl: buildConfig.agentApiBaseUrl,
  /**
   * Ligado: a IDE abre com o formulário de matrícula (ou de modo teste).
   */
  studyGate: true,
  /**
   * Sem Firebase: o Compartilhar está desligado e nada mais o usa.
   */
  firebase: null,
};
