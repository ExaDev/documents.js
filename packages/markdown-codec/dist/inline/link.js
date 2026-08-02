import { isAsciiControl, isMarkdownSpace } from "./chars.js";
import { unescapeString } from "./entity.js";
//#region src/inline/link.ts
const MAX_LINK_LABEL_LENGTH = 999;
function normalizeLinkLabel(labelWithBrackets) {
	return labelWithBrackets.slice(1, labelWithBrackets.length - 1).replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "").replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}
function matchLinkLabel(text, start) {
	if (text.charAt(start) !== "[") return 0;
	let index = start + 1;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === "[") return 0;
		if (char === "]") {
			const length = index + 1 - start;
			return length - 2 > MAX_LINK_LABEL_LENGTH ? 0 : length;
		}
		index += 1;
	}
	return 0;
}
function parseLinkDestination(text, start) {
	if (text.charAt(start) === "<") {
		let index = start + 1;
		while (index < text.length) {
			const char = text.charAt(index);
			if (char === "\\") {
				index += 2;
				continue;
			}
			if (char === "\n" || char === "<") return;
			if (char === ">") return {
				value: unescapeString(text.slice(start + 1, index)),
				end: index + 1
			};
			index += 1;
		}
		return;
	}
	let index = start;
	let openParens = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\" && text.length > index + 1) {
			index += 2;
			continue;
		}
		if (char === "(") {
			openParens += 1;
			index += 1;
			continue;
		}
		if (char === ")") {
			if (openParens === 0) break;
			openParens -= 1;
			index += 1;
			continue;
		}
		if (char === " " || isAsciiControl(char)) break;
		index += 1;
	}
	if (openParens !== 0) return;
	if (index === start && text.charAt(index) !== ")") return;
	return {
		value: unescapeString(text.slice(start, index)),
		end: index
	};
}
const TITLE_DELIMITERS = /* @__PURE__ */ new Map([
	["\"", "\""],
	["'", "'"],
	["(", ")"]
]);
function parseLinkTitle(text, start) {
	const opener = text.charAt(start);
	const closer = TITLE_DELIMITERS.get(opener);
	if (closer === void 0) return;
	let index = start + 1;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\") {
			index += 2;
			continue;
		}
		if (char === closer) return {
			value: unescapeString(text.slice(start + 1, index)),
			end: index + 1
		};
		if (opener === "(" && char === "(") return;
		index += 1;
	}
}
function skipInlineWhitespace(text, start) {
	let index = start;
	let seenLineEnding = false;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\n") {
			if (seenLineEnding) break;
			seenLineEnding = true;
			index += 1;
			continue;
		}
		if (char !== " " && char !== "	") break;
		index += 1;
	}
	return index;
}
function isBlankRemainderOfLine(text, start) {
	let index = start;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\n") return true;
		if (!isMarkdownSpace(char)) return false;
		index += 1;
	}
	return true;
}
//#endregion
export { isBlankRemainderOfLine, matchLinkLabel, normalizeLinkLabel, parseLinkDestination, parseLinkTitle, skipInlineWhitespace };
