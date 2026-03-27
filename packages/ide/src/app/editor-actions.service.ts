import { Injectable, NgZone, inject } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { EditorAction } from "@luisricar-do/agent";

function escapeRegExp(s: string): string {
  return s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * Aplica no Monaco as ações pedagógicas vindas do tutor (SSE `event: action`).
 * As ações são enfileiradas e aplicadas no próximo frame para não bloquear o thread principal
 * durante o SSE (evita competir com o worker de transpilação / Zone).
 */
@Injectable({ providedIn: "root" })
export class EditorActionsService {
  private readonly snack = inject(MatSnackBar);

  private readonly ngZone = inject(NgZone);

  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

  private decorationIds: string[] = [];

  private runCodeFn: (() => void | Promise<void>) | null = null;

  private pendingActions: EditorAction[] = [];

  private flushRaf: number | null = null;

  /**
   * Chamado quando o editor de código principal é criado ou destruído.
   */
  setEditor(editor: monaco.editor.IStandaloneCodeEditor | null): void {
    if (this.editor !== null && editor !== this.editor) {
      this.clearHighlightsInternal();
    }
    this.editor = editor;
  }

  /**
   * Necessário para `run_code_with_watch` (executa o código na IDE).
   */
  setRunCode(fn: (() => void | Promise<void>) | null): void {
    this.runCodeFn = fn;
  }

  /**
   * Quantidade de decorações ativas do tutor (linhas, variáveis, comentários inline).
   * Snacks e `run_code_with_watch` não entram nesta contagem.
   */
  get activeTutorDecorationCount(): number {
    return this.decorationIds.length;
  }

  /** Indica se há destaques/comentários do tutor aplicados no editor. */
  hasActiveTutorDecorations(): boolean {
    return this.decorationIds.length > 0;
  }

  /**
   * Remove todos os destaques e comentários inline do tutor (equivalente à tool `clear_highlights`).
   */
  clearTutorDecorations(): void {
    this.cancelPendingFlush();
    this.clearHighlightsInternal();
  }

  dispatch(action: EditorAction): void {
    this.pendingActions.push(action);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushRaf !== null) {
      return;
    }
    this.flushRaf = requestAnimationFrame(() => {
      this.flushRaf = null;
      const batch = this.pendingActions.splice(0);
      if (batch.length === 0) {
        return;
      }
      this.ngZone.run(() => {
        for (const a of batch) {
          this.applyAction(a);
        }
      });
    });
  }

  private cancelPendingFlush(): void {
    if (this.flushRaf !== null) {
      cancelAnimationFrame(this.flushRaf);
      this.flushRaf = null;
    }
    this.pendingActions = [];
  }

  private applyAction(action: EditorAction): void {
    const { type, payload } = action;

    switch (type) {
      case "highlight_line": {
        this.highlightLine(payload);
        break;
      }

      case "highlight_variable": {
        this.highlightVariable(payload);
        break;
      }

      case "compare_lines": {
        this.compareLines(payload);
        break;
      }

      case "suggest_documentation": {
        this.suggestDocumentation(payload);
        break;
      }

      case "clear_highlights": {
        this.clearHighlightsInternal();
        break;
      }

      case "add_inline_comment": {
        this.addInlineComment(payload);
        break;
      }

      case "run_code_with_watch": {
        this.runWithWatch(payload);
        break;
      }

      case "mark_bug_resolved": {
        this.clearHighlightsInternal();
        this.snack.open("Ótimo — parece que você encontrou o caminho sozinho(a). Continue assim!", "OK", {
          duration: 6000,
          panelClass: ["tutor-snack", "tutor-snack--celebrate"],
        });
        break;
      }

      case "escalate_to_direct_help": {
        const reason =
          typeof payload.reason === "string" && payload.reason.trim().length > 0
            ? payload.reason.trim()
            : "Vamos tentar uma dica mais direta no chat.";
        this.snack.open(`Próximo passo: ${reason}`, "OK", {
          duration: 8000,
          panelClass: ["tutor-snack", "tutor-snack--escalate"],
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  private clearHighlightsInternal(): void {
    const ed = this.editor;
    if (!ed || this.decorationIds.length === 0) {
      this.decorationIds = [];
      return;
    }

    ed.deltaDecorations(this.decorationIds, []);
    this.decorationIds = [];
  }

  private compareLines(payload: Record<string, unknown>): void {
    const ed = this.editor;
    const model = ed?.getModel();
    if (!ed || !model) {
      return;
    }

    const l1Raw = payload.line1;
    const l2Raw = payload.line2;
    const line1 = typeof l1Raw === "number" && Number.isFinite(l1Raw) ? Math.trunc(l1Raw) : undefined;
    const line2 = typeof l2Raw === "number" && Number.isFinite(l2Raw) ? Math.trunc(l2Raw) : undefined;
    if (line1 === undefined || line1 < 1 || line2 === undefined || line2 < 1) {
      return;
    }

    const maxLine = model.getLineCount();
    const ln1 = Math.min(Math.max(line1, 1), maxLine);
    const ln2 = Math.min(Math.max(line2, 1), maxLine);

    const decs = [ln1, ln2].map((ln, idx) => ({
      range: new monaco.Range(ln, 1, ln, Math.max(model.getLineMaxColumn(ln), 1)),
      options: {
        isWholeLine: true,
        className: idx === 0 ? "tutor-line--compare-a" : "tutor-line--compare-b",
      },
    }));

    const ids = ed.deltaDecorations([], decs);
    this.decorationIds.push(...ids);
  }

  /** Tópicos válidos alinhados à tool `suggest_documentation` no backend. */
  private suggestDocumentation(payload: Record<string, unknown>): void {
    const allowed = new Set([
      "variaveis",
      "tipos",
      "escreva",
      "leia",
      "se_senao",
      "enquanto",
      "para",
      "vetores",
      "matrizes",
    ]);
    const topicRaw = payload.topic;
    const topic = typeof topicRaw === "string" ? topicRaw.trim().toLowerCase() : "";
    const label =
      topic.length > 0 && allowed.has(topic)
        ? `Documentação sugerida: ${topic.replaceAll("_", " ")}`
        : "Abra o painel de ajuda da IDE para revisar a sintaxe deste trecho.";

    this.snack.open(label, "OK", {
      duration: 6000,
      panelClass: ["tutor-snack", "tutor-snack--escalate"],
    });
  }

  private highlightLine(payload: Record<string, unknown>): void {
    const ed = this.editor;
    const model = ed?.getModel();
    if (!ed || !model) {
      return;
    }

    const lineRaw = payload.line;
    const line = typeof lineRaw === "number" && Number.isFinite(lineRaw) ? Math.trunc(lineRaw) : undefined;
    if (line === undefined || line < 1) {
      return;
    }

    const color = payload.color === "info" ? "info" : "warning";
    const maxLine = model.getLineCount();
    const ln = Math.min(Math.max(line, 1), maxLine);
    const className = color === "warning" ? "tutor-line--warning" : "tutor-line--info";

    const ids = ed.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(ln, 1, ln, Math.max(model.getLineMaxColumn(ln), 1)),
          options: {
            isWholeLine: true,
            className,
          },
        },
      ],
    );
    this.decorationIds.push(...ids);
  }

  private highlightVariable(payload: Record<string, unknown>): void {
    const ed = this.editor;
    const model = ed?.getModel();
    if (!ed || !model) {
      return;
    }

    const name = payload.variable_name;
    if (typeof name !== "string" || name.length === 0) {
      return;
    }

    const escaped = escapeRegExp(name);
    const pattern = `\\b${escaped}\\b`;
    const matches = model.findMatches(pattern, true, true, false, null, true, 200);
    if (matches.length === 0) {
      return;
    }

    const newDecs = matches.map(m => ({
      range: m.range,
      options: {
        className: "tutor-var-match",
      },
    }));

    const ids = ed.deltaDecorations([], newDecs);
    this.decorationIds.push(...ids);
  }

  private addInlineComment(payload: Record<string, unknown>): void {
    const ed = this.editor;
    const model = ed?.getModel();
    if (!ed || !model) {
      return;
    }

    const lineRaw = payload.line;
    const line = typeof lineRaw === "number" && Number.isFinite(lineRaw) ? Math.trunc(lineRaw) : undefined;
    const comment = payload.comment;
    if (line === undefined || line < 1 || typeof comment !== "string") {
      return;
    }

    const maxLine = model.getLineCount();
    const ln = Math.min(Math.max(line, 1), maxLine);
    const safeComment = comment.replaceAll("\r\n", " ").replaceAll("\n", " ").replaceAll("\r", " ").trim();
    if (safeComment.length === 0) {
      return;
    }

    const ids = ed.deltaDecorations(
      [],
      [
        {
          range: new monaco.Range(ln, 1, ln, Math.max(model.getLineMaxColumn(ln), 1)),
          options: {
            isWholeLine: true,
            after: {
              content: `  // ${safeComment}`,
              inlineClassName: "tutor-inline-comment",
            },
          },
        },
      ],
    );
    this.decorationIds.push(...ids);
  }

  private runWithWatch(payload: Record<string, unknown>): void {
    const raw = payload.variables;
    const variables = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.length > 0) : [];

    const label =
      variables.length > 0
        ? `Execução com observação: ${variables.join(", ")}`
        : "Execução com observação de variáveis";

    this.snack.open(label, "OK", { duration: 5000 });

    const run = this.runCodeFn;
    if (run) {
      void Promise.resolve(run());
    }
  }
}
