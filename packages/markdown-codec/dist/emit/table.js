import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics.js";
import { emitRunsSingleLine } from "./inline.js";
//#region src/emit/table.ts
function toMarkdownAlignment(alignment) {
	return alignment === void 0 || alignment === "justify" ? "none" : alignment;
}
function delimiterCell(alignment) {
	switch (alignment) {
		case "left": return ":---";
		case "right": return "---:";
		case "center": return ":---:";
		case "none": return "---";
	}
}
function escapeUnescapedPipes(text) {
	let out = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\" && index + 1 < text.length) {
			out += char + text.charAt(index + 1);
			index += 2;
			continue;
		}
		if (char === "|") {
			out += "\\|";
			index += 1;
			continue;
		}
		out += char;
		index += 1;
	}
	return out;
}
function renderCellText(cell, context) {
	if (cell.colSpan !== void 0 || cell.rowSpan !== void 0 || cell.background !== void 0) context.sink({
		code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
		severity: "info",
		message: "a table cell's own colSpan/rowSpan/background has no GFM table equivalent; the cell renders as an ordinary unmerged, unstyled cell"
	});
	if (cell.blocks.length > 1) context.sink({
		code: MarkdownDiagnosticCodes.TABLE_CELL_MULTI_PARAGRAPH_JOINED,
		severity: "info",
		message: `a table cell with ${String(cell.blocks.length)} blocks has no multi-paragraph equivalent in a GFM table cell; their own rendered text is space-joined into the one line a cell allows`
	});
	const parts = [];
	for (const block of cell.blocks) {
		if (block.kind !== "paragraph") {
			context.sink({
				code: MarkdownDiagnosticCodes.TABLE_CELL_FORMATTING_DROPPED,
				severity: "info",
				message: `a table cell containing a "${block.kind}" block has no GFM table equivalent; it is dropped entirely`
			});
			continue;
		}
		const text = emitRunsSingleLine(block.runs, context);
		if (text.length > 0) parts.push(text);
	}
	return escapeUnescapedPipes(parts.join(" "));
}
function emitTable(table, context) {
	const [header, ...body] = table.rows;
	if (header === void 0) return "";
	const alignments = header.cells.map((cell) => toMarkdownAlignment(cell.blocks[0]?.kind === "paragraph" ? cell.blocks[0].alignment : void 0));
	return [
		`| ${header.cells.map((cell) => renderCellText(cell, context)).join(" | ")} |`,
		`| ${alignments.map((alignment) => delimiterCell(alignment)).join(" | ")} |`,
		...body.map((row) => `| ${row.cells.map((cell) => renderCellText(cell, context)).join(" | ")} |`)
	].join("\n");
}
//#endregion
export { emitTable };
