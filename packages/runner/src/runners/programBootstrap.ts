/**
 * Bootstrap do programa transpilado, partilhado pelos runners.
 *
 * É código-fonte JavaScript executado dentro do worker (Web Worker no navegador,
 * `worker_threads` em Node), depois do runtime do Portugol. Fala com o host pelo protocolo
 * `self.postMessage` / `self.addEventListener("message")`; o runner de Node fornece um `self`
 * equivalente, de modo que a semântica de `escreva`, `leia` e `limpa` seja a mesma nos dois.
 */
export function buildProgramBootstrap(byteCode: string): string {
  return /* javascript */ `
      const exec = ${byteCode};

      self.addEventListener("message", async (message) => {
        try {
          if (message.data.type === "start") {
            self.postMessage({ type: "started" });

            await exec({
              functions: {
                __debug: async (...args) => {
                  for (const arg of args) {
                    console.debug("➡️ DEBUG", arg);
                  }
                },

                limpa: async () => {
                  self.postMessage({ type: "clear" });
                },

                leia: async (...args) => {
                  for (const arg of args) {
                    const controller = new AbortController();
                    const signal = controller.signal;

                    self.postMessage({ type: "stdIn" });

                    const result = await new Promise((resolve) => {
                      self.addEventListener("message", (message) => {
                        if (message.data.type === "stdIn") {
                          controller.abort();
                          resolve(message.data.content);
                        }
                      }, { signal });
                    });

                    if (arg.type === "inteiro") {
                      if (!/^[-+]?[0-9]+$/.test(result)) {
                        throw new Error("O valor digitado não é inteiro!");
                      }

                      self.runtime.assign([arg, new PortugolVar("inteiro", parseInt(result, 10))]);
                    } else if (arg.type === "real") {
                      if (!/^[-+]?[0-9]+(\\.[0-9]+)?$/.test(result)) {
                        throw new Error("O valor digitado não é real!" + (result.includes(",") ? " (Dica: utilize '.' ao invés de ',')" : ""));
                      }

                      self.runtime.assign([arg, new PortugolVar("real", parseFloat(result))]);
                    } else if (arg.type === "logico") {
                      if (!/^(sim|nao|não|true|false|verdadeiro|falso|s|y|n|0|1)$/i.test(result)) {
                        throw new Error("O valor digitado não é lógico! (Dica: os valores possíveis para o tipo lógico são: 'verdadeiro', 'falso', 'sim', 'nao', 'não', 'true', 'false', 's', 'y', 'n', '0', '1')");
                      }

                      self.runtime.assign([arg, new PortugolVar("logico", result.toLowerCase() === "sim" || result.toLowerCase() === "true" || result.toLowerCase() === "verdadeiro" || result.toLowerCase() === "y" || result.toLowerCase() === "1")]);
                    } else {
                      // Tipos: cadeia ou caracter
                      self.runtime.assign([arg, new PortugolVar(arg.type, result)]);
                    }
                  }
                },

                escreva: (...args) => {
                  let str = "";
                  console.log("escreva", args);

                  for (const arg of args) {
                    if (typeof arg === "object") {
                      if (typeof arg.value !== "undefined") {
                        if (arg.type === "logico") {
                          str += arg.value ? "verdadeiro" : "falso";
                        } else {
                          str += String(arg.value);
                        }
                      }
                    } else {
                      throw new Error("Argumento inválido");
                    }
                  }

                  self.postMessage({ type: "stdOut", content: str });
                },
              },
            });
          }
        } catch (error) {
          self.postMessage({ type: "error", error: {
            message: error.message,
            stack: error.stack,
          }});
        } finally {
          self.postMessage({ type: "finish" });
        }
      }, { once: true });
  `;
}
