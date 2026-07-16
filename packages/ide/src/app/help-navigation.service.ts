import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

import { resolveDocTopic } from "./tutor-doc-topics";

/**
 * Ponte entre o chat da ADA e o painel de Ajuda: quando o aluno clica num link de documentação
 * sugerido pela tutora, o chat pede aqui a abertura do tópico. O `app.component` garante que a aba
 * de Ajuda existe/está selecionada e o `TabHelpComponent` navega até o href.
 *
 * O último href pedido fica em `pendingHref` porque a aba de Ajuda pode ainda não estar montada no
 * momento do clique — o `TabHelpComponent` consome esse valor no `ngOnInit`.
 */
@Injectable({ providedIn: "root" })
export class HelpNavigationService {
  private readonly openTopicSource = new Subject<string>();

  /** Emite o href (relativo a `assets/recursos/ajuda/`) do tópico a abrir. */
  readonly openTopic$ = this.openTopicSource.asObservable();

  private _pendingHref: string | null = null;

  /** href pedido mais recentemente e ainda não consumido pela aba de Ajuda. */
  get pendingHref(): string | null {
    return this._pendingHref;
  }

  /** Abre a documentação de um slug de tópico (ex.: "vetores"). Ignora slugs desconhecidos. */
  openTopicBySlug(slug: string): boolean {
    const topic = resolveDocTopic(slug);
    if (!topic) {
      return false;
    }
    this._pendingHref = topic.href;
    this.openTopicSource.next(topic.href);
    return true;
  }

  /** Lê e limpa o href pendente (usado pela aba de Ajuda ao montar). */
  consumePendingHref(): string | null {
    const href = this._pendingHref;
    this._pendingHref = null;
    return href;
  }
}
