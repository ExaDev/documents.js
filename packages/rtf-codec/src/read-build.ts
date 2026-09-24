// Turns the reader's own accumulated per-construct state (SectionState, PictureState, ObjectDataState/ObjectState) into the final document-schema.js shapes, or reports why it cannot and degrades instead.
import {
  type Color,
  type ContentEmbeddedObjectBlock,
  type ContentImageBlock,
  type ContentRun,
  type Margins,
  type PageSize,
} from "document-schema.js";
import { bytesToBase64 } from "byte-codec";
import { hexToBytes } from "./base64";
import { readEmbeddedObjectData } from "./embedded-object";
import { RtfDiagnosticCodes, type RtfDiagnosticSink } from "./diagnostics";
import type { RtfHeader } from "./header";
import { halfPointsToPoints, pixelsToPoints, twipsToPoints } from "./units";
import {
  type CharacterState,
  type ObjectDataState,
  type ObjectState,
  type PictureState,
  type SectionState,
} from "./read-state";

export function sectionGeometry(section: Readonly<SectionState>): {
  pageSize: PageSize;
  margins: Margins;
} {
  return {
    pageSize: {
      widthPt: twipsToPoints(section.paperWidthTwips),
      heightPt: twipsToPoints(section.paperHeightTwips),
    },
    margins: {
      topPt: twipsToPoints(section.marginTopTwips),
      rightPt: twipsToPoints(section.marginRightTwips),
      bottomPt: twipsToPoints(section.marginBottomTwips),
      leftPt: twipsToPoints(section.marginLeftTwips),
    },
  };
}

// The document-level page geometry, which is also every section's starting point and what \sectd restores. "\sectd Resets to default section properties" (RTF 1.9.1, "Section Formatting Properties") — the document's own \paperwN/\marglN and their siblings, not a fresh set of paper defaults, since a document declaring A4 does not have its second section silently revert to Letter.
export function defaultSectionState(header: RtfHeader): SectionState {
  return {
    paperWidthTwips: header.page.paperWidthTwips,
    paperHeightTwips: header.page.paperHeightTwips,
    marginLeftTwips: header.page.marginLeftTwips,
    marginRightTwips: header.page.marginRightTwips,
    marginTopTwips: header.page.marginTopTwips,
    marginBottomTwips: header.page.marginBottomTwips,
    breakType: undefined,
  };
}

export function buildRunFields(
  char: CharacterState,
  fontName: string | undefined,
  color: Color | undefined,
  hyperlink: string | undefined,
): Omit<ContentRun, "text"> {
  return {
    ...(char.bold ? { bold: true } : {}),
    ...(char.italic ? { italic: true } : {}),
    ...(char.underline ? { underline: true } : {}),
    ...(char.strike ? { strike: true } : {}),
    ...(fontName === undefined || fontName.length === 0
      ? {}
      : { fontFamily: fontName }),
    ...{ sizePt: halfPointsToPoints(char.sizeHalfPoints) },
    // Every consumer reads .color/.hyperlink/.verticalAlign/.direction by value, never by key presence.
    color,
    hyperlink,
    verticalAlign: char.verticalAlign,
    direction: char.direction,
  };
}

export function buildPicture(
  picture: PictureState,
  sink: RtfDiagnosticSink,
): ContentImageBlock | undefined {
  if (picture.format === undefined) {
    sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message: `a \\pict destination declared ${picture.unsupportedFormat ?? "no"} picture format; this reader recognises only \\pngblip and \\jpegblip, so this picture is dropped`,
    });
    return undefined;
  }
  const bytes =
    picture.binary.length > 0
      ? Uint8Array.from(picture.binary)
      : hexToBytes(picture.hex);
  if (bytes.length === 0) {
    sink({
      code: RtfDiagnosticCodes.UNSUPPORTED_PICTURE_FORMAT,
      severity: "warning",
      message: "a \\pict destination carried no picture payload",
    });
    return undefined;
  }
  const scaleX = picture.scaleXPercent / 100;
  const scaleY = picture.scaleYPercent / 100;
  const widthPt =
    picture.widthGoalTwips === undefined
      ? picture.widthPixels === undefined
        ? undefined
        : pixelsToPoints(picture.widthPixels)
      : twipsToPoints(picture.widthGoalTwips);
  const heightPt =
    picture.heightGoalTwips === undefined
      ? picture.heightPixels === undefined
        ? undefined
        : pixelsToPoints(picture.heightPixels)
      : twipsToPoints(picture.heightGoalTwips);
  if (widthPt === undefined || heightPt === undefined) {
    sink({
      code: RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
      severity: "warning",
      message:
        "a \\pict destination stated neither \\picwgoalN/\\pichgoalN nor \\picwN/\\pichN, so its rendered size is unknown and the picture is dropped; decoding the payload's own intrinsic size would need an image decoder this package deliberately does not carry",
    });
    return undefined;
  }
  const scaledWidth = widthPt * scaleX;
  const scaledHeight = heightPt * scaleY;
  if (scaledWidth <= 0 || scaledHeight <= 0) {
    sink({
      code: RtfDiagnosticCodes.PICTURE_SIZE_UNSTATED,
      severity: "warning",
      message:
        "a \\pict destination's stated size scaled to zero or less, which ContentImageBlock cannot express",
    });
    return undefined;
  }
  return {
    kind: "image",
    format: picture.format,
    base64: bytesToBase64(bytes),
    widthPt: scaledWidth,
    heightPt: scaledHeight,
  };
}

export function defaultPictureState(): PictureState {
  return {
    format: undefined,
    unsupportedFormat: undefined,
    widthGoalTwips: undefined,
    heightGoalTwips: undefined,
    widthPixels: undefined,
    heightPixels: undefined,
    scaleXPercent: 100,
    scaleYPercent: 100,
    hex: "",
    binary: [],
  };
}

// Formats \objwN/\objhN (captured on the enclosing \object's own ObjectState) as a diagnostic clause, reporting whichever of the two is actually present rather than requiring both — the degrade path's own way of not discarding a size hint the producer genuinely stated, even a partial one, even though nothing in the ContentDocument has a position left to carry it once the real object cannot be decoded.
export function objectSizeHintClause(object: ObjectState | undefined): string {
  const widthTwips = object?.widthTwips;
  const heightTwips = object?.heightTwips;
  if (widthTwips !== undefined && heightTwips !== undefined) {
    const widthPt = twipsToPoints(widthTwips).toFixed(2);
    const heightPt = twipsToPoints(heightTwips).toFixed(2);
    return ` (the object's own \\objw/\\objh declared a ${widthPt}pt x ${heightPt}pt size)`;
  }
  if (widthTwips !== undefined) {
    return ` (the object's own \\objw declared a ${twipsToPoints(widthTwips).toFixed(2)}pt width)`;
  }
  if (heightTwips !== undefined) {
    return ` (the object's own \\objh declared a ${twipsToPoints(heightTwips).toFixed(2)}pt height)`;
  }
  return "";
}

// The payload an ObjectDataState carries, as real bytes — `bytes` is already the fully decoded, ordered sequence by the time a \objdata destination's group closes, so this is a plain conversion rather than a decode.
export function objectDataBytes(
  objectData: ObjectDataState,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(objectData.bytes);
}

// Turns {\*\objdata ...}'s collected payload back into a ContentEmbeddedObjectBlock, or reports why it cannot and returns undefined — the object-destination counterpart of buildPicture above. "no payload" and "not this package's own payload" are the two distinct failure shapes (matching buildPicture's own "no format" vs "no size" split): the first never reaches readEmbeddedObjectData at all, and the second is every way a real, foreign OLE object (or simply malformed \objdata) legitimately fails to parse as one. `object` is the enclosing \object's own state, consulted only for its \objw/\objh size hint on the degrade path — readEmbeddedObjectData never needs it, since a decoded payload carries its own frame.
export function buildEmbeddedObject(
  objectData: ObjectDataState,
  object: ObjectState | undefined,
  sink: RtfDiagnosticSink,
): ContentEmbeddedObjectBlock | undefined {
  const bytes = objectDataBytes(objectData);
  if (bytes.length === 0) {
    sink({
      code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      severity: "warning",
      message: `an \\object destination's \\objdata carried no payload${objectSizeHintClause(object)}`,
    });
    return undefined;
  }
  const embedded = readEmbeddedObjectData(bytes);
  if (embedded === undefined) {
    sink({
      code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
      severity: "warning",
      message:
        "an \\object destination's \\objdata is not a payload this reader produced (a real OLE object's OLESaveToStream data has no decoder here), so the object is dropped" +
        `${objectSizeHintClause(object)}; its \\result fallback content, if any, is read in its place`,
    });
    return undefined;
  }
  // Spread first, literal last: `embedded` is a value this reader itself never controls the shape of once \objdata comes from an arbitrary (potentially hostile) input file, so a doctored payload carrying its own "kind" key must never be able to override the block's real discriminant.
  return { ...embedded, kind: "embeddedObject" };
}

// A toggle control word is on when it carries no parameter or a non-zero one, and off at exactly 0 — "\b turns on bold and \b0 turns off bold" (RTF 1.9.1, "Control Word"). `param !== 0` alone already says this: `undefined !== 0` is true under strict inequality, so the bare-word case needs no separate `param === undefined` check of its own.
