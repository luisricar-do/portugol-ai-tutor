import { PortugolErrorChecker } from "@luisricar-do/parser";
import { PortugolJs } from "@luisricar-do/runtime";

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function friendlyErrorMessage(error) {
  const message = typeof error === "object" && error !== null ? error.message : String(error);

  if (message === "Cannot read properties of undefined (reading 'clone')") {
    return "Há um identificador usado antes de ser declarado. Verifique os nomes das variáveis na linha indicada.";
  }

  return message;
}

function extractUndeclaredIdentifier(message) {
  const match = String(message).match(
    /(?:vari[aá]vel|identificador|fun[cç][aã]o)\s+n[aã]o\s+declarad[ao]:?\s*([_a-z]\w*)?/i,
  );
  return match?.[1] ?? null;
}

function firstIdentifierLocation(code, identifier) {
  if (!identifier) {
    return null;
  }
  const escaped = identifier.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`);
  const lines = String(code).split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const column = lines[index].search(pattern);
    if (column >= 0) {
      return { line: index + 1, column };
    }
  }
  return null;
}

function mapError(error, code = "") {
  if (typeof error !== "object" || error === null) {
    return {
      message: friendlyErrorMessage(error),
      startLine: 1,
      startCol: 0,
      endLine: 1,
      endCol: 1,
    };
  }

  const rawMessage = typeof error.message === "string" ? error.message : String(error.message ?? error);
  const message = friendlyErrorMessage(error);
  const lineCount = Math.max(1, String(code).split(/\r\n|\r|\n/).length);
  const identifier = extractUndeclaredIdentifier(rawMessage) ?? extractUndeclaredIdentifier(message);
  const identifierLocation = firstIdentifierLocation(code, identifier);
  let startLine =
    identifierLocation?.line ?? (isFiniteNumber(error.startLine) && error.startLine >= 1 ? error.startLine : 1);
  let startCol =
    identifierLocation?.column ?? (isFiniteNumber(error.startCol) && error.startCol >= 0 ? error.startCol : 0);
  let endLine = isFiniteNumber(error.endLine) && error.endLine >= startLine ? error.endLine : startLine;
  let endCol = isFiniteNumber(error.endCol) && error.endCol > startCol ? error.endCol : startCol + 1;

  const spansTooMuch = endLine > lineCount || (startLine === 1 && endLine >= lineCount && lineCount > 1);
  if (identifier || spansTooMuch) {
    endLine = startLine;
    endCol = startCol + Math.max(identifier?.length ?? 1, 1);
  }

  return {
    message,
    startLine,
    startCol,
    endLine,
    endCol,
  };
}

/**
 * @param {string} code
 */
function checkCode(code) {
  let errors = [];
  let parseErrors = [];

  try {
    const result = PortugolErrorChecker.checkCode(code);

    errors = result.errors;
    parseErrors = result.parseErrors;
  } catch (error) {
    console.log("check error", error);
    parseErrors.push(error);
  }

  return {
    errors: errors.map(error => mapError(error, code)),
    parseErrors: parseErrors.map(error => mapError(error, code)),
  };
}

/**
 * @param {string} code
 */
function transpileCode(code) {
  /**
   * @type {string | null}
   */
  let js = "";
  let errors = [];
  let parseErrors = [];
  let checkTime = 0;
  let transpileTime = 0;

  try {
    const checkStart = performance.now();
    const checkResult = PortugolErrorChecker.checkCode(code);

    errors = checkResult.errors;
    parseErrors = checkResult.parseErrors;

    const checkEnd = performance.now();

    checkTime = checkEnd - checkStart;

    const transpileStart = performance.now();
    js = new PortugolJs().visit(checkResult.tree);
    const transpileEnd = performance.now();

    transpileTime = transpileEnd - transpileStart;
  } catch (error) {
    parseErrors.push(error);
  }

  return {
    js,
    errors: errors.map(error => mapError(error, code)),
    parseErrors: parseErrors.map(error => mapError(error, code)),
    times: {
      check: checkTime,
      transpile: transpileTime,
    },
  };
}

self.addEventListener("message", function onmessage(e) {
  const { action, id, code } = e.data;
  let result;

  switch (action) {
    case "check": {
      result = checkCode(code);
      break;
    }

    case "transpile": {
      result = transpileCode(code);
      break;
    }

    default: {
      throw new Error(`Unknown action: ${action}`);
    }
  }

  self.postMessage({
    id,
    ...result,
  });
});
