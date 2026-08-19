import { emitMarkdown } from "./emit/emit.js";
import { flattenPackage } from "document-schema.js";
//#region src/write.ts
function writeMarkdown(documentPackage, options = {}) {
	options.signal?.throwIfAborted();
	return writeMarkdownContent(flattenPackage(documentPackage), options);
}
function writeMarkdownContent(document, options = {}) {
	options.signal?.throwIfAborted();
	return emitMarkdown(document, options);
}
//#endregion
export { writeMarkdown, writeMarkdownContent };
