//#region src/html/html.d.ts
declare function matchHtmlTag(text: string, start: number): string | undefined;
type HtmlBlockType = 1 | 2 | 3 | 4 | 5 | 6 | 7;
declare function matchHtmlBlockStart(line: string, interruptsParagraph: boolean): HtmlBlockType | undefined;
declare function matchesHtmlBlockEnd(line: string, type: HtmlBlockType): boolean;
//#endregion
export { matchesHtmlBlockEnd as i, matchHtmlBlockStart as n, matchHtmlTag as r, HtmlBlockType as t };