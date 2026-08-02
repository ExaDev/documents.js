import { lowerMarkdown } from "./lower/lower.js";
//#region src/read.ts
function readMarkdown(text, options = {}) {
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
export { readMarkdown };
