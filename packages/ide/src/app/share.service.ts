import { inject, Injectable } from "@angular/core";
import { getBlob, ref, Storage, uploadString } from "@angular/fire/storage";

import { environment } from "../environments/environment";

@Injectable({ providedIn: "root" })
export class ShareService {
  storage = inject(Storage);

  /**
   * Falso na build de coleta: o Firebase Storage é serviço de terceiro, e o que subiria
   * é o programa do estudante. As duas operações saem daqui sem tocar a rede.
   */
  private readonly enabled = environment.enableShare;

  async share(code: string): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    const shareId = (Math.random() + 1).toString(36).slice(2, 9);

    try {
      await uploadString(ref(this.storage, `share/${shareId}.por`), code, undefined, {
        contentType: "text/plain",
      });

      return `${window.location.origin}${window.location.pathname}#share=${shareId}`;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async load(shareId: string): Promise<string | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const data = await getBlob(ref(this.storage, `share/${shareId}.por`));
      const contents = await data.text();

      return contents;
    } catch (error) {
      console.error(error);
      return null;
    }
  }
}
