import { provideHttpClient, withInterceptorsFromDi } from "@angular/common/http";
import { inject, isDevMode, NgModule, provideAppInitializer, provideZoneChangeDetection } from "@angular/core";
import { initializeApp, provideFirebaseApp } from "@angular/fire/app";
import { getStorage, provideStorage } from "@angular/fire/storage";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatRippleModule } from "@angular/material/core";
import { MatDialogModule } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatMenuModule } from "@angular/material/menu";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatSnackBarModule } from "@angular/material/snack-bar";
import { MatTabsModule } from "@angular/material/tabs";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatTreeModule } from "@angular/material/tree";
import { BrowserModule } from "@angular/platform-browser";
import { RouterModule } from "@angular/router";
import { ServiceWorkerModule } from "@angular/service-worker";
import { MonacoEditorModule } from "@materia-ui/ngx-monaco-editor";
import { provideHotToastConfig } from "@ngxpert/hot-toast";
import { AngularSplitModule } from "angular-split";
import { AngularSvgIconModule } from "angular-svg-icon";
import { KeyboardShortcutsModule } from "ng-keyboard-shortcuts";
import { NgxGoogleAnalyticsModule } from "ngx-google-analytics";
import { MarkdownModule } from "ngx-markdown";
import { provideNgxWebstorage, withNgxWebstorageConfig } from "ngx-webstorage";

import { environment } from "../environments/environment";
import { withNgxLocalStorageFallback } from "../helpers/local-storage";
import { AgentChatComponent } from "./agent-chat/agent-chat.component";
import { AppComponent } from "./app.component";
import { DialogOpenExampleComponent } from "./dialog-open-example/dialog-open-example.component";
import { MonacoService } from "./monaco.service";
import { PwaService } from "./pwa.service";
import { StudySessionBarComponent } from "./study-session-bar/study-session-bar.component";
import { TabEditorComponent } from "./tab-editor/tab-editor.component";
import { TabHelpComponent } from "./tab-help/tab-help.component";
import { TabStartComponent } from "./tab-start/tab-start.component";
import { ThemeService } from "./theme.service";
import { TutorOverlayComponent } from "./tutor-overlay/tutor-overlay.component";
import { TutorTelemetryService } from "./tutor-telemetry.service";

@NgModule({
  imports: [
    AgentChatComponent,
    StudySessionBarComponent,
    TutorOverlayComponent,
    BrowserModule,
    RouterModule.forRoot([]),
    FormsModule,
    AngularSplitModule,
    MonacoEditorModule,
    KeyboardShortcutsModule.forRoot(),
    NgxGoogleAnalyticsModule.forRoot("G-ZKM28VG4G5"),
    MarkdownModule.forRoot(),
    AngularSvgIconModule.forRoot(),
    MatSnackBarModule,
    MatRippleModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatTreeModule,
    MatMenuModule,
    ServiceWorkerModule.register("ngsw-worker.js", {
      enabled: !isDevMode(),
      // Register the ServiceWorker as soon as the application is stable
      // or after 30 seconds (whichever comes first).
      registrationStrategy: "registerWhenStable:30000",
    }),
  ],
  declarations: [AppComponent, TabEditorComponent, TabStartComponent, TabHelpComponent, DialogOpenExampleComponent],
  providers: [
    provideZoneChangeDetection(),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideStorage(() => getStorage()),
    provideHttpClient(withInterceptorsFromDi()),
    provideHotToastConfig({
      position: "bottom-right",
    }),
    provideNgxWebstorage(withNgxWebstorageConfig({ prefix: "pws", separator: ":" }), withNgxLocalStorageFallback()),
    provideAppInitializer(() => {
      inject(MonacoService);
      inject(ThemeService);
      inject(PwaService);
      // Constrói a telemetria no arranque: sem isto, `session_start` só sairia
      // quando algum outro serviço a injetasse.
      inject(TutorTelemetryService);
    }),
    MonacoService,
    PwaService,
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
