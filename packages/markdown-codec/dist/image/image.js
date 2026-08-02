//#region src/image/image.ts
const BASE64_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_DECODE = (() => {
	const map = (/* @__PURE__ */ new Uint8Array(256)).fill(255);
	for (let index = 0; index < 64; index += 1) map[BASE64_TABLE.charCodeAt(index)] = index;
	return map;
})();
const BASE64_PADDING_CODE = 61;
function bytesToBase64(bytes) {
	let out = "";
	const { length } = bytes;
	for (let index = 0; index < length; index += 3) {
		const b0 = bytes[index];
		const b1 = index + 1 < length ? bytes[index + 1] : 0;
		const b2 = index + 2 < length ? bytes[index + 2] : 0;
		out += BASE64_TABLE[b0 >> 2];
		out += BASE64_TABLE[(b0 & 3) << 4 | b1 >> 4];
		out += index + 1 < length ? BASE64_TABLE[(b1 & 15) << 2 | b2 >> 6] : "=";
		out += index + 2 < length ? BASE64_TABLE[b2 & 63] : "=";
	}
	return out;
}
function base64ToBytes(base64) {
	const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
	const { length } = clean;
	const out = new Uint8Array(Math.floor(length * 3 / 4));
	let position = 0;
	for (let index = 0; index < length; index += 4) {
		const c0 = BASE64_DECODE[clean.charCodeAt(index)];
		const c1 = BASE64_DECODE[clean.charCodeAt(index + 1)];
		const code2 = clean.charCodeAt(index + 2);
		const code3 = clean.charCodeAt(index + 3);
		if (c0 === 255 || c1 === 255) throw new Error("invalid base64 input");
		out[position] = c0 << 2 | c1 >> 4;
		position += 1;
		if (code2 !== BASE64_PADDING_CODE) {
			const d2 = BASE64_DECODE[code2];
			out[position] = (c1 & 15) << 4 | d2 >> 2;
			position += 1;
			if (code3 !== BASE64_PADDING_CODE) {
				const d3 = BASE64_DECODE[code3];
				out[position] = (d2 & 3) << 6 | d3;
				position += 1;
			}
		}
	}
	return out.subarray(0, position);
}
function readUint16BE(bytes, offset) {
	return (bytes[offset] << 8 | bytes[offset + 1]) & 65535;
}
function readUint32BE(bytes, offset) {
	return (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
}
const PNG_SIGNATURE = [
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10
];
const PNG_HEADER_BYTES = 24;
function isPng(bytes) {
	if (bytes.length < PNG_SIGNATURE.length) return false;
	return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}
function readPngDimensions(bytes) {
	if (bytes.length < PNG_HEADER_BYTES) return;
	if (bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return;
	return {
		widthPx: readUint32BE(bytes, 16),
		heightPx: readUint32BE(bytes, 20)
	};
}
function isStartOfFrameMarker(marker) {
	if (marker < 192 || marker > 207) return false;
	return marker !== 196 && marker !== 200 && marker !== 204;
}
function hasNoLengthField(marker) {
	return marker === 216 || marker === 217 || marker === 1 || marker >= 208 && marker <= 215;
}
function readJpegDimensions(bytes) {
	if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return;
	let offset = 2;
	while (offset < bytes.length) {
		if (bytes[offset] !== 255) {
			offset += 1;
			continue;
		}
		let markerOffset = offset + 1;
		while (bytes[markerOffset] === 255) markerOffset += 1;
		const marker = bytes[markerOffset];
		if (marker === void 0) return;
		offset = markerOffset + 1;
		if (hasNoLengthField(marker)) continue;
		if (offset + 2 > bytes.length) return;
		const length = readUint16BE(bytes, offset);
		if (isStartOfFrameMarker(marker)) {
			if (offset + 7 > bytes.length) return;
			const heightPx = readUint16BE(bytes, offset + 3);
			return {
				widthPx: readUint16BE(bytes, offset + 5),
				heightPx
			};
		}
		if (marker === 218) return;
		offset += length;
	}
}
function isJpeg(bytes) {
	return bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 216;
}
function detectImageFormat(bytes) {
	if (isPng(bytes)) return "png";
	return isJpeg(bytes) ? "jpeg" : void 0;
}
function readImageDimensions(bytes) {
	if (isPng(bytes)) return readPngDimensions(bytes);
	return readJpegDimensions(bytes);
}
//#endregion
export { base64ToBytes, bytesToBase64, detectImageFormat, readImageDimensions };
