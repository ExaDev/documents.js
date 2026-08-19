//#region src/block/table.ts
const DELIMITER_CELL_PATTERN = /^:?-+:?$/;
function splitTableRow(line) {
	let text = line.trim();
	if (text.startsWith("|")) text = text.slice(1);
	if (endsWithUnescapedPipe(text)) text = text.slice(0, -1);
	const cells = [];
	let current = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\" && index + 1 < text.length) {
			const escaped = text.charAt(index + 1);
			current += escaped === "|" ? escaped : char + escaped;
			index += 2;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			index += 1;
			continue;
		}
		current += char;
		index += 1;
	}
	cells.push(current.trim());
	return cells;
}
function endsWithUnescapedPipe(text) {
	if (!text.endsWith("|")) return false;
	let backslashes = 0;
	while (backslashes + 1 < text.length && text.charAt(text.length - 2 - backslashes) === "\\") backslashes += 1;
	return backslashes % 2 === 0;
}
function alignmentOf(cell) {
	const left = cell.startsWith(":");
	const right = cell.endsWith(":");
	if (left && right) return "center";
	if (left) return "left";
	if (right) return "right";
	return "none";
}
function parseTableDelimiterRow(line) {
	if (!line.includes("|")) return;
	const cells = splitTableRow(line);
	if (cells.length === 0) return;
	const alignments = [];
	for (const cell of cells) {
		if (!DELIMITER_CELL_PATTERN.test(cell)) return;
		alignments.push(alignmentOf(cell));
	}
	return alignments;
}
function fitRowToColumns(cells, columnCount) {
	const fitted = cells.slice(0, columnCount);
	while (fitted.length < columnCount) fitted.push("");
	return fitted;
}
//#endregion
export { fitRowToColumns, parseTableDelimiterRow, splitTableRow };
