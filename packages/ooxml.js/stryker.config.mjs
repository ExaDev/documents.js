// Thin bootstrap only -- the real, typed configuration lives in stryker.config.ts. Stryker's own config loader is a plain import() (see @stryker-mutator/core's ConfigReader#importJSConfig) with no TypeScript support of its own, so this file exists solely to hand it a resolved object: jiti transforms and executes stryker.config.ts here, scoped to just this one file (and the stryker.shared.ts it imports), rather than installing a process-wide loader hook (node --import jiti/register) that also intercepts -- and, tried first, crashed on -- an unrelated CJS/ESM interop edge inside one of Stryker's own transitive dependencies.
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
export default await jiti.import("./stryker.config.ts", { default: true });
