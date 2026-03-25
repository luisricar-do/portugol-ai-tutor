import { enableProdMode } from "@angular/core";
import { platformBrowser } from "@angular/platform-browser";

import { AppModule } from "./app/app.module";
import { environment } from "./environments/environment";

if (environment.production) {
  enableProdMode();
}

platformBrowser()
  .bootstrapModule(AppModule)
  .then(() => {
    try {
      /** @see https://stackoverflow.com/a/51059335 */
      if ("serviceWorker" in navigator && environment.production) {
        void navigator.serviceWorker.register("/ngsw-worker.js");
      }
    } catch (error: unknown) {
      console.error("Service worker registration failed:", error);
    }
  })
  .catch((error: unknown) => {
    console.error(error);
  });
