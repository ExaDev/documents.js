import { readMarkdown } from "./read.js";
import { writeMarkdown } from "./write.js";
import { z } from "zod";
import { ContentDocumentSchema } from "document-schema.js";
//#region src/codec.ts
function isWellFormedUtf8Text(bytes) {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}
const MarkdownBytesSchema = z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: "not well-formed UTF-8 text" });
const markdownCodec = z.codec(MarkdownBytesSchema, ContentDocumentSchema, {
	decode: (bytes) => readMarkdown(new TextDecoder().decode(bytes)).document,
	encode: (document) => new TextEncoder().encode(writeMarkdown(document))
});
//#endregion
export { MarkdownBytesSchema, markdownCodec };
