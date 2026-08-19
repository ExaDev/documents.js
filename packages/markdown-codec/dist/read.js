import { lowerMarkdown } from "./lower/lower.js";
import { assemblePackage } from "document-schema.js";
//#region src/read.ts
function readMarkdown(text, options = {}) {
	const { document, diagnostics } = readMarkdownContent(text, options);
	return {
		documentPackage: assemblePackage(document),
		diagnostics
	};
}
function readMarkdownContent(text, options = {}) {
	options.signal?.throwIfAborted();
	const diagnostics = [];
	const callerSink = options.sink;
	return {
		document: lowerMarkdown(text, {
			...options,
			sink: (diagnostic) => {
				diagnostics.push(diagnostic);
				callerSink?.(diagnostic);
			}
		}),
		diagnostics
	};
}
//#endregion
export { readMarkdown, readMarkdownContent };
