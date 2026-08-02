//#region src/shared/list-id.ts
const NUMID_PATTERN = /^md(\d+):(bullet|ordered)(?:@(\d+))?(\+task)?(\+loose)?$/;
const DEFAULT_ORDERED_START = 1;
function createNumIdMintState() {
	return { next: 1 };
}
function mintListNumId(state, options) {
	const id = state.next;
	state.next += 1;
	const startSuffix = options.type === "ordered" && options.start !== void 0 && options.start !== DEFAULT_ORDERED_START ? `@${String(options.start)}` : "";
	const taskSuffix = options.task ? "+task" : "";
	const looseSuffix = options.loose ? "+loose" : "";
	return `md${String(id)}:${options.type}${startSuffix}${taskSuffix}${looseSuffix}`;
}
function parseListNumId(numId) {
	const match = NUMID_PATTERN.exec(numId);
	if (match === null) return;
	const type = match[2];
	if (type === void 0 || type !== "bullet" && type !== "ordered") return;
	const startText = match[3];
	return {
		type,
		start: type === "ordered" && startText !== void 0 ? Number.parseInt(startText, 10) : void 0,
		task: match[4] !== void 0,
		loose: match[5] !== void 0
	};
}
function mintedListType(numId) {
	return parseListNumId(numId)?.type;
}
//#endregion
export { createNumIdMintState, mintListNumId, mintedListType, parseListNumId };
