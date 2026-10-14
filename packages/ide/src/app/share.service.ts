import { inject, Service } from "@angular/core";
import { getBlob, ref, Storage, uploadString } from "@angular/fire/storage";

import { environment } from "../environments/environment";

/**
 * O resultado de compartilhar ou de abrir um código compartilhado. Na falha, o motivo é o
 * código do erro do Firebase Storage sem o prefixo (como `object-not-found` ou
 * `retry-limit-exceeded`), `offline` sem internet, `desativado` na build de coleta, ou
 * `desconhecido`: vai para o Analytics,
 * e nunca leva o código nem o identificador do link.
 */
export type ShareResult = { ok: true; value: string } | { ok: false; reason: string };

@Service()
export class ShareService {
  /**
   * Ausente quando o Firebase não é provido (build de coleta).
   */
  storage = inject(Storage, { optional: true });

  /**
   * Falso na build de coleta: o Firebase Storage é serviço de terceiro, e o que subiria
   * é o programa do estudante. As duas operações saem daqui sem tocar a rede.
   */
  private readonly enabled = environment.enableShare;

  async share(code: string): Promise<ShareResult> {
    if (!this.enabled || !this.storage) {
      return { ok: false, reason: "desativado" };
    }

    // Sem internet, nem tenta: o Firebase só desistiria depois de várias tentativas.
    if (!navigator.onLine) {
      return { ok: false, reason: "offline" };
    }

    const shareId = (Math.random() + 1).toString(36).slice(2, 9);

    try {
      await uploadString(ref(this.storage, `share/${shareId}.por`), code, undefined, {
        contentType: "text/plain",
      });

      return { ok: true, value: `${window.location.origin}${window.location.pathname}#share=${shareId}` };
    } catch (error) {
      console.error(error);
      return { ok: false, reason: this.reason(error) };
    }
  }

  async load(shareId: string): Promise<ShareResult> {
    if (!this.enabled || !this.storage) {
      return { ok: false, reason: "desativado" };
    }

    if (!navigator.onLine) {
      return { ok: false, reason: "offline" };
    }

    try {
      const data = await getBlob(ref(this.storage, `share/${shareId}.por`));
      const contents = await data.text();

      return { ok: true, value: contents };
    } catch (error) {
      console.error(error);
      return { ok: false, reason: this.reason(error) };
    }
  }

  private reason(error: unknown) {
    if (!navigator.onLine) {
      return "offline";
    }

    const code = (error as { code?: unknown } | null)?.code;

    return typeof code === "string" ? code.replace(/^storage\//, "") : "desconhecido";
  }
}
