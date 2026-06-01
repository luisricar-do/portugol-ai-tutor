import {
  ANTLRErrorListener,
  ATNConfigSet,
  ATNSimulator,
  BitSet,
  DFA,
  Parser,
  ParserRuleContext,
  ParseTree,
  RecognitionException,
  Recognizer,
  Token,
} from "antlr4ng";

interface PortugolErrorFallbackLocation {
  line: number;
  column: number;
  textLength?: number;
}

export class PortugolCodeError extends Error {
  private static readonly EMPTY_CONTEXT = { getText: () => "" } as unknown as ParseTree;

  constructor(
    public readonly message: string,
    public readonly context: ParseTree,
    public readonly startLine: number,
    public readonly startCol: number,
    public readonly endLine: number,
    public readonly endCol: number,
  ) {
    super(message);
    this.name = "PortugolCodeError";
  }

  private static fromFallbackLocation(
    ctx: ParseTree | null,
    message: string,
    fallback?: PortugolErrorFallbackLocation,
  ): PortugolCodeError | null {
    if (!fallback || !Number.isFinite(fallback.line) || fallback.line < 1) {
      return null;
    }

    const column = Number.isFinite(fallback.column) && fallback.column >= 0 ? fallback.column : 0;
    const textLength =
      typeof fallback.textLength === "number" && Number.isFinite(fallback.textLength) && fallback.textLength > 0
        ? Math.trunc(fallback.textLength)
        : 1;
    const fallbackContext = ctx ?? ({ getText: () => "" } as unknown as ParseTree);
    return new PortugolCodeError(
      message,
      fallbackContext,
      Math.trunc(fallback.line),
      Math.trunc(column),
      Math.trunc(fallback.line),
      Math.trunc(column) + textLength,
    );
  }

  private static fromPayloadToken(ctx: ParseTree | null, message: string): PortugolCodeError | null {
    if (!ctx || !Object.hasOwn(ctx, "getPayload") || typeof ctx.getPayload !== "function") {
      return null;
    }

    const possibleSymbol = ctx.getPayload() as Token | ParseTree | ParserRuleContext | undefined;
    if (!possibleSymbol || !Object.hasOwn(possibleSymbol, "column") || !Object.hasOwn(possibleSymbol, "line")) {
      return null;
    }

    const { line, column } = possibleSymbol as unknown as Token;
    const textLength =
      Object.hasOwn(ctx, "getText") && typeof ctx.getText === "function"
        ? Math.max(ctx.getText().length, 1)
        : 1;
    return new PortugolCodeError(message, ctx, line, column, line, column + textLength);
  }

  static fromContext(ctx: ParseTree | null, message: string, fallback?: PortugolErrorFallbackLocation) {
    let possibleContext = ctx;
    const fallbackError = PortugolCodeError.fromFallbackLocation(ctx, message, fallback);
    const payloadError = PortugolCodeError.fromPayloadToken(ctx, message);
    if (payloadError) {
      return payloadError;
    }

    if (
      typeof ctx === "object" &&
      ctx !== null &&
      !Object.hasOwn(ctx, "start") &&
      !Object.hasOwn(ctx, "stop") &&
      Object.hasOwn(ctx, "parent") &&
      typeof ctx.parent === "object" &&
      ctx.parent !== null
    ) {
      possibleContext = ctx.parent;
    }

    if (!possibleContext) {
      return fallbackError ?? new PortugolCodeError(message, PortugolCodeError.EMPTY_CONTEXT, 1, 0, 1, 1);
    }
    const context = ctx as ParseTree;

    if (
      Object.hasOwn(possibleContext, "start") &&
      Object.hasOwn(possibleContext, "stop") &&
      typeof (possibleContext as unknown as { start: unknown }).start === "object" &&
      (possibleContext as unknown as { start: unknown }).start !== null
    ) {
      const { start, stop } = possibleContext as unknown as { start: Token; stop?: Token };
      const { line: startLine, column: startCol } = start;

      if (typeof stop === "object" && stop !== null) {
        const { line: endLine } = stop;
        let { column: endCol } = stop;

        if (startLine === endLine && startCol === endCol) {
          endCol += context.getText().length - 1;
        }

        return new PortugolCodeError(message, context, startLine, startCol, endLine, endCol);
      }

      return new PortugolCodeError(
        message,
        context,
        Math.max(startLine - 1, 1),
        startCol,
        startLine,
        startCol + context.getText().length,
      );
    }

    if (Object.hasOwn(context, "getText") && typeof context.getText === "function") {
      return fallbackError ?? new PortugolCodeError(message, context, 1, 1, 1, 2 + context.getText().length);
    }

    return fallbackError ?? new PortugolCodeError(message, context, 1, 0, 1, 1);
  }
}

export class PortugolErrorListener implements ANTLRErrorListener {
  private errors: PortugolCodeError[] = [];

  syntaxError<T extends ATNSimulator>(
    _recognizer: Recognizer<T>,
    offendingSymbol: Token | null,
    line: number,
    charPositionInLine: number,
    _msg: string,
    e: RecognitionException | null,
  ) {
    const context = (e?.ctx || offendingSymbol || null) as unknown as ParseTree | null;
    this.errors.push(
      PortugolCodeError.fromContext(context, "Código incompleto ou inválido", {
        line,
        column: charPositionInLine,
        textLength: offendingSymbol?.text?.length,
      }),
    );
  }

  getErrors() {
    return this.errors;
  }

  reset() {
    this.errors = [];
  }

  reportAmbiguity(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _exact: boolean,
    _ambigAlts: BitSet | undefined,
    _configs: ATNConfigSet,
  ) { }

  reportAttemptingFullContext(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _conflictingAlts: BitSet | undefined,
    _configs: ATNConfigSet,
  ) { }

  reportContextSensitivity(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _prediction: number,
    _configs: ATNConfigSet,
  ) { }
}
