import { codePointAt, codePointBefore, isUnicodePunctuation, isUnicodeWhitespace } from "./chars.js";
//#region src/inline/delimiter.ts
function isDelimiterChar(char) {
	return char === "*" || char === "_" || char === "~";
}
const MAX_STRIKETHROUGH_RUN = 2;
function scanDelimiterRun(text, start, char) {
	let count = 0;
	while (text.charAt(start + count) === char) count += 1;
	if (count === 0) return;
	if (char === "~" && count > MAX_STRIKETHROUGH_RUN) return;
	const before = codePointBefore(text, start);
	const after = codePointAt(text, start + count);
	const beforeIsWhitespace = isUnicodeWhitespace(before);
	const beforeIsPunctuation = isUnicodePunctuation(before);
	const afterIsWhitespace = isUnicodeWhitespace(after);
	const afterIsPunctuation = isUnicodePunctuation(after);
	const leftFlanking = !afterIsWhitespace && (!afterIsPunctuation || beforeIsWhitespace || beforeIsPunctuation);
	const rightFlanking = !beforeIsWhitespace && (!beforeIsPunctuation || afterIsWhitespace || afterIsPunctuation);
	if (char === "_") return {
		count,
		canOpen: leftFlanking && (!rightFlanking || beforeIsPunctuation),
		canClose: rightFlanking && (!leftFlanking || afterIsPunctuation)
	};
	return {
		count,
		canOpen: leftFlanking,
		canClose: rightFlanking
	};
}
var DelimiterStack = class {
	top;
	push(char, run, node) {
		const delimiter = {
			char,
			count: run.count,
			origCount: run.count,
			canOpen: run.canOpen,
			canClose: run.canClose,
			node,
			previous: this.top,
			next: void 0
		};
		if (this.top !== void 0) this.top.next = delimiter;
		this.top = delimiter;
	}
	remove(delimiter) {
		if (delimiter.previous !== void 0) delimiter.previous.next = delimiter.next;
		if (delimiter.next === void 0) this.top = delimiter.previous;
		else delimiter.next.previous = delimiter.previous;
	}
};
function closerSignature(closer) {
	return `${closer.char}${closer.canOpen ? "1" : "0"}${String(closer.origCount % 3)}`;
}
function isRuleOfThreeBlocked(opener, closer) {
	return (closer.canOpen || opener.canClose) && closer.origCount % 3 !== 0 && (opener.origCount + closer.origCount) % 3 === 0;
}
function canMatch(opener, closer) {
	if (opener.char !== closer.char || !opener.canOpen) return false;
	if (closer.char === "~") return opener.count === closer.count;
	return !isRuleOfThreeBlocked(opener, closer);
}
function delimitersConsumedByMatch(opener, closer) {
	if (closer.char === "~") return closer.count;
	return closer.count >= 2 && opener.count >= 2 ? 2 : 1;
}
function wrapperKindFor(closer, used) {
	if (closer.char === "~") return "strikethrough";
	return used === 1 ? "emphasis" : "strong";
}
function processEmphasis(stack, stackBottom, createWrapper) {
	const openersFloor = /* @__PURE__ */ new Map();
	let closer = stack.top;
	while (closer !== void 0 && closer.previous !== stackBottom) closer = closer.previous;
	while (closer !== void 0) {
		if (!closer.canClose) {
			closer = closer.next;
			continue;
		}
		const signature = closerSignature(closer);
		const floor = openersFloor.has(signature) ? openersFloor.get(signature) : stackBottom;
		let opener = closer.previous;
		let matchedOpener;
		while (opener !== void 0 && opener !== stackBottom && opener !== floor) {
			if (canMatch(opener, closer)) {
				matchedOpener = opener;
				break;
			}
			opener = opener.previous;
		}
		const failedCloser = closer;
		if (matchedOpener === void 0) {
			closer = closer.next;
			openersFloor.set(signature, failedCloser.previous);
			if (!failedCloser.canOpen) stack.remove(failedCloser);
			continue;
		}
		const used = delimitersConsumedByMatch(matchedOpener, closer);
		const openerNode = matchedOpener.node;
		const closerNode = closer.node;
		matchedOpener.count -= used;
		closer.count -= used;
		openerNode.literal = openerNode.literal.slice(0, openerNode.literal.length - used);
		closerNode.literal = closerNode.literal.slice(0, closerNode.literal.length - used);
		const wrapper = createWrapper(wrapperKindFor(closer, used), closer.char);
		let moving = openerNode.next;
		while (moving !== void 0 && moving !== closerNode) {
			const following = moving.next;
			wrapper.appendChild(moving);
			moving = following;
		}
		openerNode.insertAfter(wrapper);
		if (matchedOpener.next !== closer) {
			matchedOpener.next = closer;
			closer.previous = matchedOpener;
		}
		if (matchedOpener.count === 0) {
			openerNode.unlink();
			stack.remove(matchedOpener);
		}
		if (closer.count === 0) {
			closerNode.unlink();
			const following = closer.next;
			stack.remove(closer);
			closer = following;
		}
	}
	while (stack.top !== void 0 && stack.top !== stackBottom) stack.remove(stack.top);
}
//#endregion
export { DelimiterStack, isDelimiterChar, processEmphasis, scanDelimiterRun };
