import { LineCursor } from "./line.cjs";
import { BlockNode, ListMarkerData } from "./node.cjs";
//#region src/block/list.d.ts
declare function parseListMarker(line: LineCursor, containerIsParagraph: boolean): ListMarkerData | undefined;
declare function listsMatch(a: ListMarkerData, b: ListMarkerData): boolean;
declare function finalizeListTightness(list: BlockNode): void;
//#endregion
export { finalizeListTightness, listsMatch, parseListMarker };