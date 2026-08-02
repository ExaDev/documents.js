import { MarkdownScanCursor } from "../scan/scan.js";
//#region src/block/line.ts
const CODE_INDENT_COLUMNS = 4;
var LineCursor = class {
	text;
	cursor;
	nextNonspaceMark;
	nextNonspaceColumn = 0;
	lineIsBlank = false;
	constructor(text) {
		this.text = text;
		this.cursor = new MarkdownScanCursor(text);
		this.nextNonspaceMark = this.cursor.mark();
		this.findNextNonspace();
	}
	get column() {
		return this.cursor.position.column;
	}
	get indent() {
		return this.nextNonspaceColumn - this.cursor.position.column;
	}
	get indented() {
		return this.indent >= 4;
	}
	get blank() {
		return this.lineIsBlank;
	}
	get atEnd() {
		return this.cursor.atEnd();
	}
	peek() {
		return this.cursor.peek();
	}
	peekNextNonspace() {
		const saved = this.cursor.mark();
		this.cursor.reset(this.nextNonspaceMark);
		const char = this.cursor.peek();
		this.cursor.reset(saved);
		return char;
	}
	findNextNonspace() {
		const saved = this.cursor.mark();
		while (this.cursor.peek() === " ") this.cursor.next();
		this.nextNonspaceMark = this.cursor.mark();
		this.nextNonspaceColumn = this.cursor.position.column;
		this.lineIsBlank = this.cursor.peek() === void 0;
		this.cursor.reset(saved);
	}
	advanceToNextNonspace() {
		this.cursor.reset(this.nextNonspaceMark);
	}
	advance(columns) {
		for (let remaining = columns; remaining > 0; remaining -= 1) if (this.cursor.next() === void 0) return;
	}
	advanceToEndOfLine() {
		while (this.cursor.next() !== void 0);
	}
	rest() {
		const mark = this.cursor.mark();
		if (mark.pendingTabColumns > 0) return " ".repeat(mark.pendingTabColumns) + this.text.slice(mark.rawOffset + 1);
		return this.text.slice(mark.rawOffset);
	}
	restFromNextNonspace() {
		return this.text.slice(this.nextNonspaceMark.rawOffset);
	}
	mark() {
		return this.cursor.mark();
	}
	reset(mark) {
		this.cursor.reset(mark);
	}
};
//#endregion
export { CODE_INDENT_COLUMNS, LineCursor };
