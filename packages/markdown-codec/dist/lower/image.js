import { base64ToBytes, bytesToBase64, detectImageFormat, readImageDimensions } from "../image/image.js";
//#region src/lower/image.ts
const POINTS_PER_PIXEL = 72 / 96;
const DATA_URI_PATTERN = /^data:image\/(?:png|jpe?g);base64,(.+)$/is;
function decodeDataUriImage(destination) {
	const base64 = DATA_URI_PATTERN.exec(destination)?.[1];
	if (base64 === void 0) return;
	try {
		return base64ToBytes(base64);
	} catch {
		return;
	}
}
function resolveMarkdownImage(destination, context, resolver) {
	const bytes = decodeDataUriImage(destination) ?? resolver?.(destination, context)?.bytes;
	if (bytes === void 0) return;
	const format = detectImageFormat(bytes);
	const dimensions = readImageDimensions(bytes);
	if (format === void 0 || dimensions === void 0) return;
	return {
		format,
		base64: bytesToBase64(bytes),
		widthPt: dimensions.widthPx * POINTS_PER_PIXEL,
		heightPt: dimensions.heightPx * POINTS_PER_PIXEL
	};
}
//#endregion
export { resolveMarkdownImage };
