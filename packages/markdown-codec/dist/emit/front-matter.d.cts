import { LayoutMetadata } from "document-schema.js";
//#region src/emit/front-matter.d.ts
declare function emitFrontMatter(metadata: LayoutMetadata): string | undefined;
//#endregion
export { emitFrontMatter };