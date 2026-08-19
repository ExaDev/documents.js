import { lowerInlineNodes } from "./inline.js";
//#region src/lower/table.ts
const MIN_COLUMN_COUNT = 1;
function toParagraphAlignment(alignment) {
	return alignment === "none" ? void 0 : alignment;
}
function lowerTableCell(cell, alignment, context) {
	const runs = lowerInlineNodes(cell.children, context);
	const paragraphAlignment = toParagraphAlignment(alignment ?? "none");
	return { blocks: [{
		kind: "paragraph",
		runs,
		...paragraphAlignment === void 0 ? {} : { alignment: paragraphAlignment }
	}] };
}
function lowerTable(node, contentWidthPt, context) {
	const columnCount = Math.max(MIN_COLUMN_COUNT, node.alignments.length);
	const columnWidthsPt = Array.from({ length: columnCount }, () => contentWidthPt / columnCount);
	return {
		kind: "table",
		rows: node.children.map((row) => ({ cells: row.children.map((cell, index) => lowerTableCell(cell, node.alignments[index], context)) })),
		columnWidthsPt
	};
}
//#endregion
export { lowerTable };
