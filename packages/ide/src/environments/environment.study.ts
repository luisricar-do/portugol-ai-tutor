import { buildVersion } from "./environment.version";

/**
 * Build de coleta: a IDE que os estudantes usam nas sessões.
 *
 * Difere da build pública em dois pontos, e são esses que o TCLE declara: nenhum dado
 * sai para serviço de terceiro.
 *
 * `enableAnalytics: false` impede o `app.module.ts` de chamar
 * `NgxGoogleAnalyticsModule.forRoot`, que é o único caminho que carrega o `gtag.js`, e
 * substitui o `GoogleAnalyticsService` por um no-op, de modo que também as diretivas
 * `gaEvent` dos templates deixem de ter efeito.
 *
 * `enableShare: false` retira o botão Compartilhar e neutraliza o `ShareService`, que
 * de outro modo escreveria o programa do estudante no Firebase Storage.
 *
 * `enableTutorTelemetry` fica ligada: é o registo da pesquisa, e a fila envia apenas
 * para `{agentApiBaseUrl}/telemetry`, o serviço do tutor mantido pela pesquisa.
 *
 * Usar com `ng build --configuration study` ou `ng serve --configuration study`.
 */
export const environment = {
  production: true,
  commitSha: buildVersion.commitSha,
  buildDate: buildVersion.buildDate,
  /** Ligada: é o instrumento da pesquisa, e a fila só fala com o serviço do tutor. */
  enableTutorTelemetry: true,
  enableAnalytics: false,
  /** Vazia de propósito: com a substituição de ficheiro, o id não chega ao pacote de coleta. */
  analyticsMeasurementId: "",
  /** Desligado: o Compartilhar enviaria o código do estudante ao Firebase Storage. */
  enableShare: false,
  /** Defina no build (substituição de arquivo) ou ajuste antes de cada sessão de coleta. */
  agentApiBaseUrl: "",
  firebase: {
    apiKey: "AIzaSyD_6fjI7Vsm4RQS6EJZSZ_an7Zehjz9YwQ",
    authDomain: "portugol-webstudio.firebaseapp.com",
    projectId: "portugol-webstudio",
    storageBucket: "portugol-webstudio.appspot.com",
    messagingSenderId: "845512624544",
    appId: "1:845512624544:web:b1d4787cafd265429dfcc5",
    // `measurementId` omitido: nenhum módulo de Analytics do Firebase é provido, e sem
    // ele nenhuma propriedade `G-…` sobra no pacote para a auditoria encontrar.
  },
};
