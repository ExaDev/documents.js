import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics.js";
import { MATH_INLINE_FONT_MARKER, MONOSPACE_FONT_FAMILY } from "../shared/style-constants.js";
//#region src/lower/inline.ts
function buildRun(text, style, fontFamily) {
	return {
		text,
		...style.bold === true ? { bold: true } : {},
		...style.italic === true ? { italic: true } : {},
		...style.strike === true ? { strike: true } : {},
		...style.hyperlink !== void 0 ? { hyperlink: style.hyperlink } : {},
		...fontFamily !== void 0 ? { fontFamily } : {}
	};
}
function lowerNestedEmphasisLike(kind, node, style, context) {
	if (style[kind] === true) context.sink({
		code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED,
		severity: "info",
		message: `a ${kind === "italic" ? "emphasis" : kind === "bold" ? "strong emphasis" : "strikethrough"} span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run`
	});
	const childStyle = {
		...style,
		[kind]: true
	};
	return node.children.flatMap((child) => lowerInlineNode(child, childStyle, context));
}
function lowerInlineNode(node, style, context) {
	switch (node.type) {
		case "text": return node.value.length === 0 ? [] : [buildRun(node.value, style)];
		case "entity": return node.value.length === 0 ? [] : [buildRun(node.value, style)];
		case "softBreak": return [buildRun(" ", style)];
		case "hardBreak": return [buildRun("\n", style)];
		case "codeSpan": return [buildRun(node.literal, style, MONOSPACE_FONT_FAMILY)];
		case "rawHtml":
			if (context.rawHtml === "drop") {
				context.sink({
					code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
					severity: "info",
					message: "inline raw HTML was dropped per the rawHtml: \"drop\" option"
				});
				return [];
			}
			context.sink({
				code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
				severity: "info",
				message: "inline raw HTML was preserved as literal text; it will not be rendered as HTML by any consumer of the resulting ContentDocument"
			});
			return node.literal.length === 0 ? [] : [buildRun(node.literal, style)];
		case "mathInline":
			context.sink({
				code: MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT,
				severity: "info",
				message: "inline math (\\( \\)) was preserved as literal raw LaTeX text; it is not parsed as LaTeX or converted to MathML by this package"
			});
			return [buildRun(node.literal, style, MATH_INLINE_FONT_MARKER)];
		case "autolink": {
			const destination = node.email ? `mailto:${node.destination}` : node.destination;
			return [buildRun(node.destination, {
				...style,
				hyperlink: destination
			})];
		}
		case "link": {
			if (node.title !== void 0) context.sink({
				code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED,
				severity: "info",
				message: `link title "${node.title}" has no ContentRun equivalent and was dropped`
			});
			const childStyle = {
				...style,
				hyperlink: node.destination
			};
			const runs = node.children.flatMap((child) => lowerInlineNode(child, childStyle, context));
			return runs.length > 0 ? runs : [buildRun("", childStyle)];
		}
		case "image":
			if (node.title !== void 0) context.sink({
				code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED,
				severity: "info",
				message: `image title "${node.title}" has no ContentRun equivalent and was dropped`
			});
			return [buildRun(node.alt, {
				...style,
				hyperlink: node.destination
			})];
		case "emphasis": return lowerNestedEmphasisLike("italic", node, style, context);
		case "strong": return lowerNestedEmphasisLike("bold", node, style, context);
		case "strikethrough": return lowerNestedEmphasisLike("strike", node, style, context);
	}
}
function lowerInlineNodes(nodes, context) {
	return nodes.flatMap((node) => lowerInlineNode(node, {}, context));
}
function lowerCodeBlockRun(literal) {
	return {
		text: literal,
		fontFamily: MONOSPACE_FONT_FAMILY
	};
}
//#endregion
export { lowerCodeBlockRun, lowerInlineNode, lowerInlineNodes };
