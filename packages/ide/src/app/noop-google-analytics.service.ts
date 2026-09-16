import { Injectable } from "@angular/core";
import type { GoogleAnalyticsService } from "ngx-google-analytics";

type AnalyticsSurface = Pick<GoogleAnalyticsService, "event" | "pageView" | "appView" | "set" | "exception" | "gtag">;

/**
 * Substitui o `GoogleAnalyticsService` quando `environment.enableAnalytics` é falso.
 *
 * Sem `NgxGoogleAnalyticsModule.forRoot(...)` nenhum script é carregado e nada sai da
 * máquina, mas o serviço do pacote continua injetável (`providedIn: "root"`) e as suas
 * chamadas empilhariam eventos no `window.dataLayer`. Como as diretivas `gaEvent` dos
 * templates injetam o serviço por tipo, e não pela flag, substituí-lo aqui é o que põe
 * todos os pontos de chamada — os 30 em TypeScript e os 12 em template — atrás da
 * mesma decisão de build.
 *
 * `AnalyticsSurface` existe para o compilador recusar esta classe se o pacote mudar a
 * assinatura de algum destes métodos.
 */
@Injectable({ providedIn: "root" })
export class NoopGoogleAnalyticsService implements AnalyticsSurface {
  event(): void {
    return;
  }

  pageView(): void {
    return;
  }

  appView(): void {
    return;
  }

  set(): void {
    return;
  }

  exception(): void {
    return;
  }

  gtag(): void {
    return;
  }
}
