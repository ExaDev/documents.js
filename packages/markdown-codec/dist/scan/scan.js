//#region src/scan/scan.ts
const MARKDOWN_TAB_STOP_WIDTH = 4;
var MarkdownScanCursor = class {
	source;
	rawOffset = 0;
	lineNumber = 1;
	columnNumber = 0;
	pendingTabColumns = 0;
	constructor(source) {
		this.source = source;
	}
	get position() {
		return {
			offset: this.rawOffset,
			line: this.lineNumber,
			column: this.columnNumber
		};
	}
	atEnd() {
		return this.pendingTabColumns === 0 && this.rawOffset >= this.source.length;
	}
	peek() {
		if (this.pendingTabColumns > 0) return " ";
		if (this.rawOffset >= this.source.length) return;
		const char = this.source[this.rawOffset];
		if (char === "	") return " ";
		if (char === "\r") return "\n";
		return char;
	}
	peekRaw(count) {
		return this.source.slice(this.rawOffset, this.rawOffset + count);
	}
	next() {
		if (this.pendingTabColumns > 0) {
			this.pendingTabColumns -= 1;
			this.columnNumber += 1;
			if (this.pendingTabColumns === 0) this.rawOffset += 1;
			return " ";
		}
		if (this.rawOffset >= this.source.length) return;
		const char = this.source[this.rawOffset];
		if (char === "	") {
			const width = 4 - this.columnNumber % 4;
			this.columnNumber += 1;
			if (width > 1) this.pendingTabColumns = width - 1;
			else this.rawOffset += 1;
			return " ";
		}
		if (char === "\r") {
			this.rawOffset += this.source[this.rawOffset + 1] === "\n" ? 2 : 1;
			this.lineNumber += 1;
			this.columnNumber = 0;
			return "\n";
		}
		this.rawOffset += 1;
		if (char === "\n") {
			this.lineNumber += 1;
			this.columnNumber = 0;
		} else this.columnNumber += 1;
		return char;
	}
	mark() {
		return {
			rawOffset: this.rawOffset,
			lineNumber: this.lineNumber,
			columnNumber: this.columnNumber,
			pendingTabColumns: this.pendingTabColumns
		};
	}
	reset(mark) {
		this.rawOffset = mark.rawOffset;
		this.lineNumber = mark.lineNumber;
		this.columnNumber = mark.columnNumber;
		this.pendingTabColumns = mark.pendingTabColumns;
	}
};
//#endregion
export { MARKDOWN_TAB_STOP_WIDTH, MarkdownScanCursor };
