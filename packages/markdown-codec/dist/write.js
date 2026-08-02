import { emitMarkdown } from "./emit/emit.js";
//#region src/write.ts
function writeMarkdown(document, options = {}) {
	options.signal?.throwIfAborted();
	return emitMarkdown(document, options);
}
//#endregion
export { writeMarkdown };
