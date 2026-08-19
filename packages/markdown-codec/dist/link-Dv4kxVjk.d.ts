//#region src/inline/link.d.ts
interface LinkReferenceDefinition {
  readonly destination: string;
  readonly title?: string;
}
type LinkReferenceMap = ReadonlyMap<string, LinkReferenceDefinition>;
declare function normalizeLinkLabel(labelWithBrackets: string): string;
declare function matchLinkLabel(text: string, start: number): number;
interface ParsedSpan {
  readonly value: string;
  readonly end: number;
}
declare function parseLinkDestination(text: string, start: number): ParsedSpan | undefined;
declare function parseLinkTitle(text: string, start: number): ParsedSpan | undefined;
declare function skipInlineWhitespace(text: string, start: number): number;
declare function isBlankRemainderOfLine(text: string, start: number): boolean;
//#endregion
export { matchLinkLabel as a, parseLinkTitle as c, isBlankRemainderOfLine as i, skipInlineWhitespace as l, LinkReferenceMap as n, normalizeLinkLabel as o, ParsedSpan as r, parseLinkDestination as s, LinkReferenceDefinition as t };