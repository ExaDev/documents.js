import { DEFAULT_MARGINS } from "../defaults/defaults.js";
import { MarkdownDiagnosticCodes, MarkdownInputTooLargeError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { parseMarkdown } from "../block/block.js";
import { createNumIdMintState, mintListNumId, mintedListType } from "../shared/list-id.js";
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, MATH_BLOCK_STYLE_ID, QUOTE_STYLE_ID, headingStyleId } from "../shared/style-constants.js";
import { extractFrontMatter } from "./front-matter.js";
import { resolveMarkdownImage } from "./image.js";
import { lowerCodeBlockRun, lowerInlineNodes } from "./inline.js";
import { lowerTable } from "./table.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
//#region src/lower/lower.ts
function inlineContext(context) {
	return {
		sink: context.sink,
		rawHtml: context.rawHtmlMode
	};
}
function decorateParagraph(paragraph, context) {
	let result = paragraph;
	if (context.quoteDepth > 0) result = {
		...result,
		indentLeftPt: context.quoteDepth * 36,
		...result.styleId === void 0 ? { styleId: QUOTE_STYLE_ID } : {}
	};
	if (context.list !== void 0) result = {
		...result,
		list: {
			numId: context.list.numId,
			level: context.list.level
		}
	};
	return result;
}
function lowerHeading(node, context) {
	return [decorateParagraph({
		kind: "paragraph",
		runs: lowerInlineNodes(node.children, inlineContext(context)),
		styleId: headingStyleId(node.level),
		headingLevel: node.level
	}, context)];
}
function lowerParagraph(node, context) {
	const blocks = [];
	const inlineCtx = inlineContext(context);
	let segment = [];
	const flushSegment = (force) => {
		if (segment.length === 0 && !force) return;
		blocks.push(decorateParagraph({
			kind: "paragraph",
			runs: lowerInlineNodes(segment, inlineCtx)
		}, context));
		segment = [];
	};
	for (const child of node.children) {
		if (child.type !== "image") {
			segment.push(child);
			continue;
		}
		const resolved = resolveMarkdownImage(child.destination, {
			alt: child.alt,
			title: child.title
		}, context.images);
		if (resolved === void 0) {
			context.sink({
				code: MarkdownDiagnosticCodes.IMAGE_UNRESOLVED,
				severity: "info",
				message: `image "${child.destination}" could not be resolved to real bytes; it degrades to a text run of its own alt text, hyperlinked at its own destination`
			});
			segment.push(child);
			continue;
		}
		if (child.title !== void 0) context.sink({
			code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED,
			severity: "info",
			message: `image title "${child.title}" has no ContentImageBlock equivalent and was dropped`
		});
		flushSegment(false);
		if (context.list !== void 0) context.sink({
			code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
			severity: "info",
			message: "a resolved image block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost"
		});
		blocks.push({
			kind: "image",
			format: resolved.format,
			base64: resolved.base64,
			widthPt: resolved.widthPt,
			heightPt: resolved.heightPt,
			...child.alt.length > 0 ? { altText: child.alt } : {}
		});
	}
	flushSegment(blocks.length === 0);
	return blocks;
}
function lowerCodeBlock(node, context) {
	if (node.fenced && node.infoString !== void 0 && node.infoString.length > 0) context.sink({
		code: MarkdownDiagnosticCodes.CODE_BLOCK_INFO_STRING_DROPPED,
		severity: "info",
		message: `fenced code block's own info string "${node.infoString}" has no ContentParagraph equivalent and was dropped`
	});
	return [decorateParagraph({
		kind: "paragraph",
		runs: [lowerCodeBlockRun(node.literal.replace(/\n$/, ""))],
		styleId: CODE_BLOCK_STYLE_ID
	}, context)];
}
function lowerThematicBreak(context) {
	return [decorateParagraph({
		kind: "paragraph",
		runs: [],
		styleId: HORIZONTAL_RULE_STYLE_ID
	}, context)];
}
function lowerHtmlBlock(node, context) {
	if (context.rawHtmlMode === "drop") {
		context.sink({
			code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
			severity: "info",
			message: "block-level raw HTML was dropped per the rawHtml: \"drop\" option"
		});
		return [];
	}
	context.sink({
		code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
		severity: "info",
		message: "block-level raw HTML was preserved as literal text (styleId \"HTMLPreformatted\"); it will not be rendered as HTML by any consumer of the resulting ContentDocument"
	});
	const literal = node.literal.replace(/\n+$/, "");
	return [decorateParagraph({
		kind: "paragraph",
		runs: literal.length === 0 ? [] : [{ text: literal }],
		styleId: HTML_PREFORMATTED_STYLE_ID
	}, context)];
}
function lowerMathBlock(node, context) {
	context.sink({
		code: MarkdownDiagnosticCodes.MATH_BLOCK_PRESERVED_AS_TEXT,
		severity: "info",
		message: "block math ($$...$$) was preserved as literal raw LaTeX text (styleId \"MathBlock\"); it is not parsed as LaTeX or converted to MathML by this package"
	});
	const literal = node.literal.replace(/\n$/, "");
	return [decorateParagraph({
		kind: "paragraph",
		runs: literal.length === 0 ? [] : [{ text: literal }],
		styleId: MATH_BLOCK_STYLE_ID
	}, context)];
}
function lowerBlockquote(node, context, contentWidthPt) {
	if (context.quoteDepth >= 1) context.sink({
		code: MarkdownDiagnosticCodes.BLOCKQUOTE_NESTED_DEPTH,
		severity: "info",
		message: `blockquote nesting beyond level 1 is represented only as a larger indentLeftPt (${String((context.quoteDepth + 1) * 36)}pt); recovering the exact nesting depth back out is an approximation, not an exact inverse`
	});
	const nested = {
		...context,
		quoteDepth: context.quoteDepth + 1
	};
	const blocks = node.children.flatMap((child) => lowerBlock(child, nested, contentWidthPt));
	if (blocks.length === 0) return [decorateParagraph({
		kind: "paragraph",
		runs: []
	}, nested)];
	return blocks;
}
function applyTaskCheckbox(blocks, checked) {
	const first = blocks[0];
	if (first?.kind !== "paragraph") return false;
	const checkboxRun = { text: `${checked ? "☒" : "☐"} ` };
	blocks[0] = {
		...first,
		runs: [checkboxRun, ...first.runs]
	};
	return true;
}
function lowerListItem(item, numId, level, context, contentWidthPt) {
	if (item.children.filter((child) => child.type !== "list").length > 1) context.sink({
		code: MarkdownDiagnosticCodes.LIST_ITEM_MULTI_BLOCK_FLATTENED,
		severity: "info",
		message: "a list item directly containing more than one block loses its own item boundary once lowered -- ContentListMembership carries only numId/level, with no field distinguishing \"one item, several blocks\" from \"several items sharing this numId/level\""
	});
	const itemContext = {
		...context,
		list: {
			numId,
			level
		}
	};
	const blocks = [];
	let checkboxApplied = item.checked === void 0;
	let ownLevelBlockCount = 0;
	for (const child of item.children) {
		if (child.type === "list") {
			blocks.push(...lowerList(child, numId, level + 1, context, contentWidthPt));
			continue;
		}
		const childBlocks = lowerBlock(child, itemContext, contentWidthPt);
		ownLevelBlockCount += childBlocks.length;
		if (!checkboxApplied) checkboxApplied = applyTaskCheckbox(childBlocks, item.checked === true);
		blocks.push(...childBlocks);
	}
	if (ownLevelBlockCount === 0) {
		const placeholder = [decorateParagraph({
			kind: "paragraph",
			runs: []
		}, itemContext)];
		if (!checkboxApplied) applyTaskCheckbox(placeholder, item.checked === true);
		blocks.unshift(...placeholder);
	}
	return blocks;
}
function lowerList(node, ancestorNumId, level, context, contentWidthPt) {
	let numId;
	if (ancestorNumId === void 0) {
		const task = node.children.some((item) => item.checked !== void 0);
		numId = mintListNumId(context.numIdState, {
			type: node.markerType,
			start: node.start,
			task,
			loose: !node.tight
		});
	} else {
		numId = ancestorNumId;
		const mintedType = mintedListType(numId);
		if (mintedType !== void 0 && mintedType !== node.markerType) context.sink({
			code: MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT,
			severity: "warning",
			message: `a nested ${node.markerType} list sits under a list minted as ${mintedType}; the enclosing list's own marker type is kept (first-wins) and this nested list's own type is not separately represented`
		});
	}
	return node.children.flatMap((item) => lowerListItem(item, numId, level, context, contentWidthPt));
}
function lowerBlock(node, context, contentWidthPt) {
	switch (node.type) {
		case "paragraph": return lowerParagraph(node, context);
		case "heading": return lowerHeading(node, context);
		case "blockquote": return lowerBlockquote(node, context, contentWidthPt);
		case "list": return lowerList(node, void 0, 0, context, contentWidthPt);
		case "codeBlock": return lowerCodeBlock(node, context);
		case "thematicBreak": return lowerThematicBreak(context);
		case "htmlBlock": return lowerHtmlBlock(node, context);
		case "mathBlock": return lowerMathBlock(node, context);
		case "table":
			if (context.list !== void 0) context.sink({
				code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
				severity: "info",
				message: "a table directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost"
			});
			return [lowerTable(node, contentWidthPt, inlineContext(context))];
		case "document":
		case "listItem":
		case "tableRow":
		case "tableCell": return [];
	}
}
function lowerParsedMarkdown(parsed, options = {}, metadata = {}) {
	const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	sink({
		code: MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
		severity: "info",
		message: "markdown carries no page geometry of its own; the resulting ContentSection uses a synthesised page size and margins (ReadMarkdownOptions.pageSize/margins, or document-schema.js's own PAGE_SIZE_A4 default)"
	});
	const pageSize = options.pageSize ?? PAGE_SIZE_A4;
	const margins = options.margins ?? DEFAULT_MARGINS;
	const contentWidthPt = pageSize.widthPt - margins.leftPt - margins.rightPt;
	const context = {
		sink,
		images: options.images,
		rawHtmlMode: options.rawHtml ?? "preserve",
		numIdState: createNumIdMintState(),
		quoteDepth: 0,
		list: void 0
	};
	return {
		kind: "wordprocessing",
		metadata,
		sections: [{
			pageSize,
			margins,
			blocks: parsed.document.children.flatMap((child) => lowerBlock(child, context, contentWidthPt))
		}]
	};
}
function lowerMarkdown(source, options = {}) {
	if (options.maxInputBytes !== void 0) {
		const actualBytes = new TextEncoder().encode(source).length;
		if (actualBytes > options.maxInputBytes) throw new MarkdownInputTooLargeError(options.maxInputBytes, actualBytes);
	}
	const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	const { metadata, rest } = options.frontMatter ?? false ? extractFrontMatter(source, sink) : {
		metadata: {},
		rest: source
	};
	const parseOptions = {
		gfmTables: options.gfmTables,
		gfmAutolinks: options.gfmAutolinks,
		gfmStrikethrough: options.gfmStrikethrough,
		gfmTaskLists: options.gfmTaskLists,
		maxNesting: options.maxBlockNesting,
		sink
	};
	return lowerParsedMarkdown(parseMarkdown(rest, parseOptions), options, metadata);
}
//#endregion
export { lowerMarkdown, lowerParsedMarkdown };
