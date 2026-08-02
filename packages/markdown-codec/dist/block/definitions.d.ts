import { i as MarkdownDiagnosticSink } from "../diagnostics-DmuWc7d8.js";
import { t as LinkReferenceDefinition } from "../link-Dv4kxVjk.js";
//#region src/block/definitions.d.ts
declare function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>, sink?: MarkdownDiagnosticSink, startLine?: number): string;
//#endregion
export { extractDefinitions };