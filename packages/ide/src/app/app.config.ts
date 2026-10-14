import { provideHttpClient } from "@angular/common/http";
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  isDevMode,
  provideAppInitializer,
  provideZoneChangeDetection,
} from "@angular/core";
import { initializeApp, provideFirebaseApp } from "@angular/fire/app";
import { getStorage, provideStorage } from "@angular/fire/storage";
import { provideServiceWorker } from "@angular/service-worker";
import { provideHotToastConfig } from "@ngxpert/hot-toast";
import { provideAngularSplitOptions } from "angular-split";
import { provideAngularSvgIcon } from "angular-svg-icon";
import { GoogleAnalyticsService, NgxGoogleAnalyticsModule } from "ngx-google-analytics";
import { MARKED_EXTENSIONS, provideMarkdown } from "ngx-markdown";
import { provideNgxWebstorage, withNgxWebstorageConfig } from "ngx-webstorage";

import { environment } from "../environments/environment";
import { withNgxLocalStorageFallback } from "../helpers/local-storage";
import { RELEASE_CHANNEL } from "./beta";
import { MonacoService } from "./monaco.service";
import { NoopGoogleAnalyticsService } from "./noop-google-analytics.service";
import { PwaService } from "./pwa.service";
import { markedPortugol } from "./tab-help/marked-portugol";
import { ThemeService } from "./theme.service";
import { TutorTelemetryService } from "./tutor-telemetry.service";

/**
 * Só com o Compartilhar ligado: é o único uso do Firebase. A build de coleta não o inicializa.
 */
const firebaseConfig = environment.enableShare ? environment.firebase : null;

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection(),
    ...(firebaseConfig
      ? [
          provideFirebaseApp(() => initializeApp(firebaseConfig)),
          provideStorage(() => {
            const storage = getStorage();

            // O padrão do Firebase é tentar de novo por até 10 minutos, com o botão de compartilhar
            // esperando e sem nenhum aviso. Sem conexão, 15 segundos bastam para desistir e avisar.
            storage.maxUploadRetryTime = 15_000;
            storage.maxOperationRetryTime = 15_000;

            return storage;
          }),
        ]
      : []),
    provideHttpClient(),
    provideAngularSvgIcon(),
    // Divisores com um vão de 8px, como entre as áreas do VS Code (ver `styles/_split.scss`)
    provideAngularSplitOptions({ gutterSize: 8 }),
    provideHotToastConfig({
      position: "bottom-right",
      closeLabel: "Fechar aviso",
    }),
    provideNgxWebstorage(withNgxWebstorageConfig({ prefix: "pws", separator: ":" }), withNgxLocalStorageFallback()),
    // Ponto único do Google Analytics. `forRoot` é o que registra o initializer que injeta o
    // `gtag.js`: sem ele o pacote não faz pedido nenhum. Com a flag desligada (build de coleta),
    // quem injetar `GoogleAnalyticsService` — inclusive as diretivas `gaEvent` dos templates,
    // que o pedem por tipo — recebe o no-op.
    environment.enableAnalytics
      ? importProvidersFrom(
          NgxGoogleAnalyticsModule.forRoot(environment.analyticsMeasurementId, [
            // Parâmetros do `config` acompanham todos os eventos, inclusive o `page_view` automático.
            { command: "config", values: [environment.analyticsMeasurementId, { app_channel: RELEASE_CHANNEL }] },
          ]),
        )
      : { provide: GoogleAnalyticsService, useClass: NoopGoogleAnalyticsService },
    provideServiceWorker("ngsw-worker.js", {
      enabled: !isDevMode(),
      // Registra o service worker quando a aplicação fica estável, ou depois de 10 segundos.
      registrationStrategy: "registerWhenStable:10000",
    }),
    provideAppInitializer(() => {
      inject(MonacoService);
      inject(ThemeService);
      inject(PwaService);
      // Constrói a telemetria no arranque: sem isto, `session_start` só sairia
      // quando algum outro serviço a injetasse.
      inject(TutorTelemetryService);
    }),
    provideMarkdown({
      markedExtensions: [
        {
          provide: MARKED_EXTENSIONS,
          multi: true,
          useValue: {
            hooks: {
              // Links externos abrem em outra aba do navegador, sem tirar o usuário do IDE
              postprocess: (html: string) => {
                return html.replaceAll(
                  /<a href="(https?:\/\/)/g,
                  '<a target="_blank" rel="external noreferrer noopener nofollow" href="$1',
                );
              },
            },
          },
        },
        {
          provide: MARKED_EXTENSIONS,
          multi: true,
          useValue: markedPortugol,
        },
      ],
    }),
  ],
};
