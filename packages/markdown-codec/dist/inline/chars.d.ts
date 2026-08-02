//#region src/inline/chars.d.ts
declare function isAsciiPunctuation(char: string): boolean;
declare function isUnicodeWhitespace(char: string): boolean;
declare function isUnicodePunctuation(char: string): boolean;
declare function isAsciiControl(char: string): boolean;
declare function containsAsciiControlOrSpace(text: string): boolean;
declare function isMarkdownSpace(char: string): boolean;
declare function codePointBefore(text: string, index: number): string;
declare function codePointAt(text: string, index: number): string;
//#endregion
export { codePointAt, codePointBefore, containsAsciiControlOrSpace, isAsciiControl, isAsciiPunctuation, isMarkdownSpace, isUnicodePunctuation, isUnicodeWhitespace };