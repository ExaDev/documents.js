//#region src/inline/footnote.d.ts
interface FootnoteLabelMatch {
  readonly label: string;
  readonly end: number;
}
declare function matchFootnoteLabel(text: string, start: number): FootnoteLabelMatch | undefined;
interface FootnoteDefinitionMatch {
  readonly label: string;
  readonly markerLength: number;
}
declare function matchFootnoteDefinitionMarker(lineText: string): FootnoteDefinitionMatch | undefined;
type FootnoteLabelSet = ReadonlySet<string>;
declare function isValidFootnoteLabel(label: string): boolean;
//#endregion
export { matchFootnoteDefinitionMarker as a, isValidFootnoteLabel as i, FootnoteLabelMatch as n, matchFootnoteLabel as o, FootnoteLabelSet as r, FootnoteDefinitionMatch as t };