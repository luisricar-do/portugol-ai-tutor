import { NestedTreeControl } from "@angular/cdk/tree";
import { HttpClient } from "@angular/common/http";
import { AfterViewInit, Component, inject, NgZone, OnDestroy, OnInit, output } from "@angular/core";
import { MatTreeNestedDataSource } from "@angular/material/tree";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { GoogleAnalyticsService } from "ngx-google-analytics";
import { Subscription } from "rxjs";

import { HelpNavigationService } from "../help-navigation.service";
import { ResponsiveService } from "../responsive.service";
import { ThemeService } from "../theme.service";
import { libsTree } from "./bibliotecas";
import { TreeItem } from "./types";

type PortugolWindow = Window & {
  portugol: { abrirExemplo(contents: string, name: string): void };
};

@Component({
  selector: "app-tab-help",
  // eslint-disable-next-line @angular-eslint/prefer-standalone
  standalone: false,
  templateUrl: "./tab-help.component.html",
  styleUrl: "./tab-help.component.scss",
})
export class TabHelpComponent implements OnInit, OnDestroy, AfterViewInit {
  private http = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);
  private ngZone = inject(NgZone);
  private gaService = inject(GoogleAnalyticsService);
  private responsive = inject(ResponsiveService);
  private themeService = inject(ThemeService);
  private helpNavigation = inject(HelpNavigationService);

  _responsive$?: Subscription;
  _theme$?: Subscription;
  _helpNav$?: Subscription;

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  treeControl = new NestedTreeControl<TreeItem>(node => node.children);
  dataSource = new MatTreeNestedDataSource<TreeItem>();
  current?: TreeItem;
  currentUrl?: SafeResourceUrl;

  isBelowMd = false;
  isLightTheme = false;

  readonly newTab = output<{ name: string; contents: string }>();

  ngOnInit() {
    (window as unknown as PortugolWindow).portugol = {
      abrirExemplo: (contents: string, name: string) => {
        this.ngZone.run(() => {
          this.newTab.emit({ name, contents });
        });
      },
    };

    this.http.get<TreeItem[]>("assets/recursos/ajuda/scripts/topicos.json").subscribe({
      next: ajuda => {
        const ajudaWithLibs = ajuda.concat(libsTree);

        this.dataSource.data = ajudaWithLibs;
        this.treeControl.expand(ajudaWithLibs[0]);
        this.treeControl.expand(ajudaWithLibs[1]);

        // A ADA pode ter pedido um tópico antes da aba de Ajuda montar: abre nele se houver pendência.
        const pendingHref = this.helpNavigation.consumePendingHref();
        if (!pendingHref || !this.navigateToHref(pendingHref)) {
          this.loadItem(ajudaWithLibs[0]);
        }
      },
      error: () => {
        // TODO: tratar erro
      },
    });

    // Aba de Ajuda já aberta: novos pedidos da ADA navegam direto para o tópico.
    this._helpNav$ = this.helpNavigation.openTopic$.subscribe(href => {
      this.navigateToHref(href);
    });

    this._theme$ = this.themeService.theme$.subscribe(theme => {
      this.isLightTheme = theme === "light";
    });
  }

  ngAfterViewInit() {
    this._responsive$ = this.responsive.isBelowMd().subscribe(isBelowMd => {
      this.isBelowMd = isBelowMd.matches;
    });
  }

  ngOnDestroy() {
    this._responsive$?.unsubscribe();
    this._theme$?.unsubscribe();
    this._helpNav$?.unsubscribe();
  }

  hasChildren(_: number, item: TreeItem) {
    return item.children?.length ?? 0;
  }

  /**
   * Abre o tópico cujo `href` corresponde ao pedido, expandindo os nós ancestrais na árvore.
   * Retorna `false` se o href não existir na árvore de ajuda.
   */
  private navigateToHref(href: string): boolean {
    const path = this.findPathByHref(this.dataSource.data, href);
    const target = path?.at(-1);
    if (!path || !target) {
      return false;
    }
    // Expande ancestrais para o nó ficar visível na árvore lateral.
    for (const ancestor of path.slice(0, -1)) {
      this.treeControl.expand(ancestor);
    }
    this.loadItem(target);
    return true;
  }

  /** Busca em profundidade o caminho (raiz → nó) até o item com o `href` dado. */
  private findPathByHref(items: TreeItem[] | undefined, href: string): TreeItem[] | null {
    for (const item of items ?? []) {
      if (item.href === href) {
        return [item];
      }
      const childPath = this.findPathByHref(item.children, href);
      if (childPath) {
        return [item, ...childPath];
      }
    }
    return null;
  }

  loadItem(item: TreeItem) {
    this.gaService.event("help_navigation", "Ajuda", item.href || item.source);
    this.gaService.pageView(item.href || item.id, item.text, item.href || item.id);
    this.current = item;

    if (item.kind !== "markdown") {
      this.currentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(`assets/recursos/ajuda/${item.href}`);
    }
  }
}
