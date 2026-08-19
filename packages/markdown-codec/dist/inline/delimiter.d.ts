import { InlineNode } from "./node.js";
//#region src/inline/delimiter.d.ts
type DelimiterChar = '*' | '_' | '~';
declare function isDelimiterChar(char: string): char is DelimiterChar;
interface Delimiter {
  readonly char: DelimiterChar;
  count: number;
  readonly origCount: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  readonly node: InlineNode;
  previous: Delimiter | undefined;
  next: Delimiter | undefined;
}
interface DelimiterRun {
  readonly count: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}
declare function scanDelimiterRun(text: string, start: number, char: DelimiterChar): DelimiterRun | undefined;
declare class DelimiterStack {
  top: Delimiter | undefined;
  push(char: DelimiterChar, run: DelimiterRun, node: InlineNode): void;
  remove(delimiter: Delimiter): void;
}
type EmphasisWrapperFactory = (kind: 'emphasis' | 'strong' | 'strikethrough', marker: DelimiterChar) => InlineNode;
declare function processEmphasis(stack: DelimiterStack, stackBottom: Delimiter | undefined, createWrapper: EmphasisWrapperFactory): void;
//#endregion
export { Delimiter, DelimiterChar, DelimiterRun, DelimiterStack, EmphasisWrapperFactory, isDelimiterChar, processEmphasis, scanDelimiterRun };