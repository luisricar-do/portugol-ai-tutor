// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

import { buildVersion } from "./environment.version";

export const environment = {
  production: false,
  commitSha: buildVersion.commitSha,
  buildDate: buildVersion.buildDate,
  /** Registo estruturado de eventos do tutor (dissertação); desligar em demos públicas se necessário. */
  enableTutorTelemetry: true,
  /**
   * Carrega o Google Analytics (gtag) e liga as chamadas ao `GoogleAnalyticsService`.
   * Falso substitui o serviço por um no-op e nunca injeta o script: nenhum pedido sai
   * para `googletagmanager.com`. Ver `app.module.ts` e `environment.study.ts`.
   */
  enableAnalytics: true,
  /** Propriedade do GA. Vazia nas builds que não medem, para o id não entrar no pacote. */
  analyticsMeasurementId: "G-ZKM28VG4G5",
  /**
   * Botão Compartilhar código. Liga o `ShareService`, que envia o programa do estudante
   * para o Firebase Storage (Google). Falso oculta o botão, ignora o `#share=` do URL e
   * neutraliza o serviço: o Storage deixa de receber qualquer coisa.
   */
  enableShare: true,
  /** Base URL da API Azure Functions (inclua `/api`). Ex.: http://localhost:7071/api */
  agentApiBaseUrl: "http://localhost:7071/api",
  firebase: {
    apiKey: "AIzaSyD_6fjI7Vsm4RQS6EJZSZ_an7Zehjz9YwQ",
    authDomain: "portugol-webstudio.firebaseapp.com",
    projectId: "portugol-webstudio",
    storageBucket: "portugol-webstudio.appspot.com",
    messagingSenderId: "845512624544",
    appId: "1:845512624544:web:b1d4787cafd265429dfcc5",
    measurementId: "G-BM3QGZS096",
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
