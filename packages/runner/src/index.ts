export * from "./PortugolExecutor.js";
export * from "./runners/PortugolWebWorkersRunner.js";
export * from "./runners/IPortugolRunner.js";
export * from "./runners/programBootstrap.js";

// O executor headless (`PortugolNodeRunner`, `runPortugolProgram`) depende de
// `node:worker_threads` e fica fora deste barrel de propósito: a IDE importa
// `@luisricar-do/runner` no bundle do browser, que não resolve módulos de Node.
// Em Node, importe de `@luisricar-do/runner/headless`.
