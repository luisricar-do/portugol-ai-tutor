// Ponto de entrada do executor headless em Node. Separado do barrel principal porque
// `PortugolNodeRunner` importa `node:worker_threads`, que não existe no browser.
export * from "../runners/PortugolNodeRunner.js";
export * from "./runProgram.js";
