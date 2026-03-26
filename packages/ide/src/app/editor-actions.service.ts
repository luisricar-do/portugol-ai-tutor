import { Injectable, inject } from "@angular/core";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { EditorAction } from "@luisricar-do/agent";

function escapeRegExp(s: string): string {
  return s.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * Aplica no Monaco as ações pedagógicas vindas do tutor (SSE `event: action`).
 */
@Injectable({ providedIn: "root" })
export class EditorActionsService {
  private readonly snack = inject(MatSnackBar);

  private editor: monaco.editor.IStandaloneCodeEditor | null = null;

  private decorationIds: string[] = [];

  private runCodeFn: (() => void | Promise<void>) | null = null;

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

  dispatch(action: EditorAction): void {
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
    const matches = model.findMatches(pattern, true, true, false, null, true, 500);
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
