import { ContentImageBlock } from "document-schema.js";
//#region src/emit/image.d.ts
declare function emitImage(block: ContentImageBlock, embedData: boolean): string;
//#endregion
export { emitImage };