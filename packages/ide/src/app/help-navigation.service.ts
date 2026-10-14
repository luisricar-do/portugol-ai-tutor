import { Service } from "@angular/core";
import { Subject } from "rxjs";

import { resolveDocTopic } from "./tutor-doc-topics";

/**
 * Ponte entre o chat da ADA e o painel de Ajuda: quando o aluno clica num link de documentação
 * sugerido pela tutora, o chat pede aqui a abertura do tópico. O `app.component` abre ou traz para
 * a frente a aba de Ajuda e repassa o tópico ao `WorkspaceService.helpTopicRequest`, o mesmo
 * caminho dos endereços `#ajuda=`; a aba de Ajuda espera os tópicos carregarem, se preciso.
 */
@Service()
export class HelpNavigationService {
  private readonly openTopicSource = new Subject<string>();

  /**
   *  * Emite o caminho do tópico a abrir (o `arquivo` de `topicos.json`).
   */
  readonly openTopic$ = this.openTopicSource.asObservable();

  /**
   *  * Abre a documentação de um slug de tópico (ex.: "vetores"). Ignora slugs desconhecidos.
   */
  openTopicBySlug(slug: string): boolean {
    const topic = resolveDocTopic(slug);
    if (!topic) {
      return false;
    }
    this.openTopicSource.next(topic.href);
    return true;
  }
}
