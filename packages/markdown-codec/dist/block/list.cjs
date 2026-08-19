Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
require("./line.cjs");
//#region src/block/list.ts
const BULLET_MARKER_PATTERN = /^[*+-]/;
const ORDERED_MARKER_PATTERN = /^(\d{1,9})([.)])/;
const NON_SPACE_PATTERN = /[^ \t\f\v\r\n]/;
const INTERRUPTING_ORDERED_START = 1;
function isBulletMarker(char) {
	return char === "-" || char === "*" || char === "+";
}
function isOrderedDelimiter(char) {
	return char === "." || char === ")";
}
function matchMarker(rest, indent, containerIsParagraph) {
	const bullet = BULLET_MARKER_PATTERN.exec(rest);
	if (bullet !== null) {
		const char = bullet[0];
		if (!isBulletMarker(char)) return;
		return {
			length: bullet[0].length,
			data: {
				type: "bullet",
				bulletChar: char,
				markerOffset: indent
			}
		};
	}
	const ordered = ORDERED_MARKER_PATTERN.exec(rest);
	const digits = ordered?.[1];
	const delimiter = ordered?.[2];
	if (ordered === null || digits === void 0 || delimiter === void 0 || !isOrderedDelimiter(delimiter)) return;
	const start = Number.parseInt(digits, 10);
	if (containerIsParagraph && start !== INTERRUPTING_ORDERED_START) return;
	return {
		length: ordered[0].length,
		data: {
			type: "ordered",
			delimiter,
			start,
			markerOffset: indent
		}
	};
}
function parseListMarker(line, containerIsParagraph) {
	if (line.indented) return;
	const rest = line.restFromNextNonspace();
	const match = matchMarker(rest, line.indent, containerIsParagraph);
	if (match === void 0) return;
	const afterMarker = rest.charAt(match.length);
	if (afterMarker !== "" && afterMarker !== " " && afterMarker !== "	") return;
	if (containerIsParagraph && !NON_SPACE_PATTERN.test(rest.slice(match.length))) return;
	line.advanceToNextNonspace();
	line.advance(match.length);
	const afterMarkerMark = line.mark();
	const afterMarkerColumn = line.column;
	do
		line.advance(1);
	while (line.column - afterMarkerColumn <= 4 && line.peek() === " ");
	const followingSpaces = line.column - afterMarkerColumn;
	const startsBlank = line.atEnd;
	if (followingSpaces > 4 || followingSpaces < 1 || startsBlank) {
		line.reset(afterMarkerMark);
		if (line.peek() === " ") line.advance(1);
		return {
			...match.data,
			padding: match.length + 1
		};
	}
	return {
		...match.data,
		padding: match.length + followingSpaces
	};
}
function listsMatch(a, b) {
	return a.type === b.type && a.delimiter === b.delimiter && a.bulletChar === b.bulletChar;
}
function endsWithBlankLine(block) {
	let current = block;
	while (current !== void 0) {
		if (current.lastLineBlank) return true;
		if (!current.lastLineChecked && (current.kind === "list" || current.kind === "listItem")) {
			current.lastLineChecked = true;
			current = current.lastChild;
			continue;
		}
		current.lastLineChecked = true;
		return false;
	}
	return false;
}
function finalizeListTightness(list) {
	for (const [index, item] of list.children.entries()) {
		const hasFollowingItem = index < list.children.length - 1;
		if (hasFollowingItem && endsWithBlankLine(item)) {
			list.tight = false;
			return;
		}
		for (const [childIndex, child] of item.children.entries()) {
			const hasFollowingBlock = childIndex < item.children.length - 1;
			if ((hasFollowingItem || hasFollowingBlock) && endsWithBlankLine(child)) {
				list.tight = false;
				return;
			}
		}
	}
}
//#endregion
exports.finalizeListTightness = finalizeListTightness;
exports.listsMatch = listsMatch;
exports.parseListMarker = parseListMarker;
