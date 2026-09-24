// The \pict/\object destination writing group: an image block's own decode-or-warn step, the \pict destination itself, and the \object envelope an embedded (non-image) object writes.
import type {
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
} from "document-schema.js";
import { base64ToBytes, bytesToHex } from "./base64";
import { RtfDiagnosticCodes } from "./diagnostics";
import { writeEmbeddedObjectData } from "./embedded-object";
import { pointsToTwips } from "./units";
import { escapeText } from "./write-text";
import { line, raw, type Writer } from "./write-state";

// The spec's own transmission advice — "you may also want to insert a carriage-return/line feed pair without backslashes at least every 255 characters" — applied to the one payload long enough to matter. A reader ignores the breaks entirely.
const HEX_LINE_LENGTH = 128;

function wrapHex(hex: string, lineEnding: string): string {
  const lines: string[] = [];
  for (let index = 0; index < hex.length; index += HEX_LINE_LENGTH) {
    lines.push(hex.slice(index, index + HEX_LINE_LENGTH));
  }
  return lines.join(lineEnding);
}

// The two failure cases a \pict destination can hit: a format RTF has no picture-type keyword for, or a base64 payload that does not decode to anything. Both write nothing at all, so this is checked before any surrounding separator is committed rather than after.
export function decodeImageOrWarn(
  writer: Writer,
  image: Pick<ContentImageBlock, "format" | "widthPt" | "heightPt"> & {
    base64: string;
  },
): Uint8Array | undefined {
  // RTF's \pict destination has no picture-type keyword for either format: it predates SVG entirely, and GIF is not among the classic \emfblip/\pngblip/\jpegblip/\macpict/\pmmetafile/\wmetafile/\dibitmap/\wbitmap set. Writing one as \jpegblip (as this writer once silently did for anything that was not exactly "png") would mislabel the payload's own encoding to any reader that takes the keyword at its word.
  if (image.format === "svg" || image.format === "gif") {
    writer.sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message: `an image block in ${image.format} format cannot be written: RTF's \\pict destination has no picture-type keyword for it, so the image is dropped rather than mislabelled as a format it is not`,
    });
    return undefined;
  }
  const bytes = base64ToBytes(image.base64);
  if (bytes === undefined || bytes.length === 0) {
    writer.sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message:
        "an image block's base64 payload could not be decoded, so no \\pict destination is written for it",
    });
    return undefined;
  }
  return bytes;
}

// Emits the \pict destination itself from an already-decoded payload — `inTable` gives the outer \pard the same \intbl variant writeParagraph(paragraph, inTable) takes.
export function writeImagePict(
  writer: Writer,
  bytes: Uint8Array,
  image: Readonly<Pick<ContentImageBlock, "format" | "widthPt" | "heightPt">>,
  inTable: boolean,
): void {
  const widthTwips = pointsToTwips(image.widthPt);
  const heightTwips = pointsToTwips(image.heightPt);
  const pict =
    `\\pard\\plain${inTable ? "\\intbl" : ""} {\\*\\shppict{\\pict\\${image.format === "png" ? "pngblip" : "jpegblip"}` +
    `\\picwgoal${String(widthTwips)}\\pichgoal${String(heightTwips)}${writer.lineEnding}` +
    `${wrapHex(bytesToHex(bytes), writer.lineEnding)}}}`;
  if (inTable) {
    raw(writer, pict);
  } else {
    line(writer, `${pict}\\par`);
  }
}

export function writeImageParagraph(
  writer: Writer,
  base64: string,
  image: Readonly<Pick<ContentImageBlock, "format" | "widthPt" | "heightPt">>,
): void {
  const bytes = decodeImageOrWarn(writer, { ...image, base64 });
  if (bytes === undefined) {
    return;
  }
  writeImagePict(writer, bytes, image, false);
}

// RTF 1.9.1's own <obj> grammar: '{' \object (<objtype> & ... & <objsize>?) <objdata> <result> '}' — \objemb (this is always an embedded object, never a link: ContentEmbeddedObjectBlock has no linked-object variant), the <objhw> size hint (\objwN\objhN, informational only — a reader that decodes \objdata below never consults it), {\*\objclass ...} naming the payload's own objectKind, {\*\objdata ...}'s hex payload — a full [MS-OLEDS] EmbeddedObject envelope (ObjectHeader + NativeDataSize + the real [MS-CFB] container as NativeData + a mandatory Presentation field) that embedded-object.ts's own writeEmbeddedObjectData builds, not the compound file alone — and a minimal {\result ...} fallback paragraph for a reader that does not decode \object at all (the spec: "This allows RTF readers that do not understand objects ... to use the current result, in place of the object, to maintain appearance"). `inTable` gives the outer \pard the same \intbl variant writeParagraph(paragraph, inTable) takes — read.ts's own \object handling already proves an \object group sitting inside an ordinary \intbl paragraph reads back positioned within the cell's own block list.
export function writeEmbeddedObjectBlock(
  writer: Writer,
  block: ContentEmbeddedObjectBlock,
  inTable = false,
): void {
  const widthTwips = pointsToTwips(block.frame.widthPt);
  const heightTwips = pointsToTwips(block.frame.heightPt);
  const objdataBytes = writeEmbeddedObjectData(block);
  const object =
    `\\pard\\plain${inTable ? "\\intbl" : ""} {\\object\\objemb\\objw${String(widthTwips)}\\objh${String(heightTwips)}` +
    `{\\*\\objclass ${escapeText(block.objectKind)}}` +
    `{\\*\\objdata${writer.lineEnding}` +
    `${wrapHex(bytesToHex(objdataBytes), writer.lineEnding)}}` +
    `{\\result{\\pard\\plain ${escapeText(`[embedded ${block.objectKind} object]`)}\\par}}}`;
  if (inTable) {
    raw(writer, object);
  } else {
    line(writer, `${object}\\par`);
  }
}
