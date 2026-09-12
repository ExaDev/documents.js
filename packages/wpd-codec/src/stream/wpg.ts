import type {
  Box,
  Color,
  ContentBlock,
  ContentShape,
  ContentStroke,
  ContentSubpath,
  ContentVector,
  PageSize,
} from "document-schema.js";
import { byteAt, int16At, uint16At, uint32At } from "../bytes/view";

// -- WPG (WordPerfect Graphic) vector graphics, per the SDK's "WordPerfect Graphic File Format" pages --
//
// A WPG file opens with the same 26-byte prefix family a WordPerfect document does (file ID FF 57 50 43, a long pointer to the data, product/file-type/version bytes), distinguished from a document by its file-type byte 22 (0x16). From the pointer onwards it is an ordered sequence of drawing records: a header of Class (1 byte), Type (1 byte), Extension (a count field, 1/3/5 bytes), and Length (the same count-field coding), then exactly Length bytes of data. The Extension count groups physical records into logical ones -- a record whose count is N is followed by N more records belonging to it, and a grouped logical record counts as one record to the next outermost group's count. A Group record's children are independent objects each with their own attributes; every other grouped record's children belong to their opener (a Text Block's Text Data, a Bitmap's palette and data, a Compound Polygon's paths), so when this reader skips a grouped record it skips the whole group and walks on only after that group's members have passed. The one opener whose member still walks after a successful decode is the Text Block: its Text Data extension is the payload itself, folded through the injected WP fold rather than skipped with it.
//
// THE SCOPE OF THIS DECODER, stated because a WPG record stream has a long tail and this is deliberately a layered subset, not "WPG support": decoded are the record framing itself; Start WPG (the units, precision, and image extent every coordinate conversion needs); the flat colour and weight attributes (Pen Fore Color, Pen Size, Brush Fore Color, and their double-precision variants); and the common primitives -- Polyline (two unclosed points as the shared model's own line variant when a stroke resolved, more points as a path, a closed one as a closed subpath), Rectangle (square corners as a rect, rounded corners as a path of kappa-approximated quarter-ellipses), Arc with identical endpoint offsets (the full ellipse the specification itself defines that spelling to mean), and Text Block with its Text Data extension (a WP document stream, folded through this package's own tokeniser and fold via the callback the caller injects). Every other record type is recognised by the walk, skipped whole, and named in the diagnostic the caller reports -- among them Polyspline, Polycurve, Compound Polygon, Bitmap, Bitmap Data, Text Line, Text Path, Chart and its style/data companions, Object Image, Object Capsule, the pen style/pattern and brush pattern/gradient/texture families (a non-flat pen or brush pattern has no flat colour this reader could honestly approximate it with), and the page-settings records. A record carrying a transformation in its characterisation flags (taper, translate, skew, scale, or rotate) is skipped rather than decoded with the transformation dropped -- its geometry would be wrong, not partial. WPG 1.0-major files are refused outright: that is a separate record vocabulary (type byte and length only, no class or extension fields, palette-indexed colours, 1200ths-of-an-inch units) which the vendor pages this package builds from do not document, and misparsing one as WPG 2.x would decode rubbish rather than refuse.
//
// Coordinates are single precision (signed 16-bit) or double precision (32-bit 16.16 fixed point) per Start WPG's own precision byte, in units of the Start WPG record's pixels-per-inch, with Y increasing upward from a bottom-left origin. The shared vector model is top-left origin, Y down, in points -- so every coordinate divides by the pixels-per-inch and multiplies by 72, and every Y flips against the image extent's height.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_1graph.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_2g-rec.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_4g-txt.htm

// The record types this decoder gives a meaning to. Every other type number the walk meets is skipped and named through the caller's diagnostic.
const RECORD_START_WPG = 0x01;
const RECORD_END_WPG = 0x02;
const RECORD_TEXT_DATA = 0x0f;
const RECORD_POLYLINE = 0x15;
const RECORD_RECTANGLE = 0x18;
const RECORD_ARC = 0x19;
const RECORD_TEXT_BLOCK = 0x1d;
const RECORD_GROUP = 0x20;
const RECORD_PEN_FORE_COLOR = 0x25;
const RECORD_DP_PEN_FORE_COLOR = 0x26;
const RECORD_PEN_SIZE = 0x2b;
const RECORD_DP_PEN_SIZE = 0x2c;
const RECORD_BRUSH_FORE_COLOR = 0x31;
const RECORD_DP_BRUSH_FORE_COLOR = 0x32;

// The record names reported for skipped records, keyed by type number so the diagnostic can name exactly what a given file carried. Only the types the specification names are listed; an unknown type number reports its number. The types this decoder otherwise gives a meaning to appear here too, because each has a spelling that refuses it (a Start WPG too short to carry an extent, a Text Data with no Text Block before it, a Polyline or Rectangle carrying a transformation, a partial Arc) and a refusal that names its record is the contract the caller's diagnostic reports.
const RECORD_NAMES: ReadonlyMap<number, string> = new Map([
  [0x01, "Start WPG"],
  [0x03, "Form Settings"],
  [0x04, "Ruler Settings"],
  [0x05, "Grid Settings"],
  [0x06, "Layer"],
  [0x07, "ObjectLink"],
  [0x08, "Pen Style Definition"],
  [0x09, "Pattern Definition"],
  [0x0a, "Comment"],
  [0x0b, "Color Transfer"],
  [0x0c, "Color Palette"],
  [0x0d, "DP Color Palette"],
  [0x0e, "Bitmap Data"],
  [0x0f, "Text Data"],
  [0x10, "Chart Style"],
  [0x11, "Chart Data"],
  [0x12, "Object Image"],
  [0x15, "Polyline"],
  [0x16, "Polyspline"],
  [0x17, "Polycurve"],
  [0x18, "Rectangle"],
  [0x19, "Arc"],
  [0x1a, "Compound Polygon"],
  [0x1b, "Bitmap"],
  [0x1c, "Text Line"],
  [0x1d, "Text Block"],
  [0x1e, "Text Path"],
  [0x1f, "Chart"],
  [0x21, "Object Capsule"],
  [0x22, "Font Settings"],
  [0x27, "Pen Back Color"],
  [0x28, "DP Pen Back Color"],
  [0x29, "Pen Style"],
  [0x2a, "Pen Pattern"],
  [0x2d, "Line Cap"],
  [0x2e, "Line Join"],
  [0x2f, "Brush Gradient"],
  [0x30, "DP Brush Gradient"],
  [0x33, "Brush Back Color"],
  [0x34, "DP Brush Back Color"],
  [0x35, "Brush Pattern"],
  [0x36, "Horizontal Line"],
  [0x37, "Vertical Line"],
  [0x38, "Poster Settings"],
  [0x39, "Image State"],
  [0x3a, "Envelope Definition"],
  [0x3b, "Envelope"],
  [0x3c, "Texture Definition"],
  [0x3d, "Brush Texture"],
  [0x3e, "Texture Alignment"],
  [0x3f, "Pen Texture"],
]);

// Characterisation flag bits, per the SDK's own table: bits 0-4 state that optional transformation data follows (taper, translate, skew, scale, rotate -- every one a transformation this decoder refuses a record for), bit 5 an Object ID, bit 7 an edit-lock descriptor, and the high byte's two-state options -- bit 12 the winding path rule, bit 13 fill, bit 14 close, bit 15 frame.
const FLAG_TAPER = 1 << 0;
const FLAG_TRANSLATE = 1 << 1;
const FLAG_SKEW = 1 << 2;
const FLAG_SCALE = 1 << 3;
const FLAG_ROTATE = 1 << 4;
const FLAG_OBJECT_ID = 1 << 5;
const FLAG_EDIT_LOCK = 1 << 7;
const FLAG_PATH_WINDING = 1 << 12;
const FLAG_FILL = 1 << 13;
const FLAG_CLOSE = 1 << 14;
const FLAG_FRAME = 1 << 15;

// The one approximation this decoder makes: a rounded Rectangle's corners are quarter ellipses, and the shared path model carries only straight and cubic segments, so each quarter becomes the standard cubic approximation of a quarter ellipse -- control points offset by 4/3*(sqrt(2)-1) of the radii, the identical bounded approximation this family's SVG path module applies to elliptical arcs at no more than 90 degrees per cubic. Derived from the circle constant here rather than hard-coded, so the geometry and its derivation stay checkable together.
const QUARTER_ELLIPSE_KAPPA = (4 / 3) * (Math.SQRT2 - 1);

// The WPG prefix's own product/file-type/version gates: product type 1 ("always 1 for WPG files"), file type 22 (0x16, "always 22 for WPG files"), and the major version byte that separates the two record vocabularies (2 for the framed record stream this decoder reads, 1 for WPG 1.0's earlier type-and-length-only stream it refuses).
const WPG_PRODUCT_TYPE = 1;
const WPG_FILE_TYPE = 0x16;
const WPG_MAJOR_2 = 2;
const WPG_MAJOR_1 = 1;

// The fixed prefix head: file ID (4), {start of document} (4), product type, file type, major version, minor version, [encryption key] (2), [start packet data] (2), entry count, resource complete, [start encryption] (2), {file size} (4), [encryption version] (2). Every field this decoder reads sits inside it.
const WPG_PREFIX_HEAD_SIZE = 26;

const POINTS_PER_INCH = 72;

// The one injected dependency: a Text Data record's bytes are a WP document stream, and folding one into blocks is the read layer's own machinery (the identical tokeniser and fold a box's WP-text content takes) -- injected as a callback so this module stays a pure byte decoder with no dependency back on src/read.ts.
export type WpgTextFold = (documentArea: Uint8Array) => readonly ContentBlock[];

// What a decode produced: either the drawing's page size and decoded vectors and shapes (plus the names of the record types the walk skipped), or the reason a graphic this reader recognises still did not decode.
export type WpgDecode =
  | {
      readonly status: "decoded";
      readonly sizePt: PageSize;
      readonly vectors: readonly ContentVector[];
      readonly shapes: readonly ContentShape[];
      readonly skippedRecords: readonly string[];
    }
  | {
      readonly status: "refused";
      readonly reason: "wpg1" | "encrypted" | "malformed";
    };

// A colour with the transparency channel kept beside the RGB the shared model carries: transparency rides the separate opacity fields (ContentStroke.opacity, ContentVector.fillOpacity) rather than the model's alpha-less Color.
interface WpgColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// The running rendition state a drawing's records decode against, seeded from the specification's own "WPG Defaults" table: pen and brush foreground black, pen width 0 ("0 = hairline", the thinnest width the output device can render), opacities fully opaque. The hairline default has no positive point value the shared stroke shape can state (its widthPt is positive-only), so a framed record with no Pen Size record states no stroke at all -- the identical reading the family's PDF reconstruction gives a zero-width paint, whose stroke is likewise absent rather than a guessed width.
interface WpgRenditionState {
  penColor: WpgColor;
  penWidthUnits: number;
  brushColor: WpgColor;
}

const WPG_DEFAULT_BLACK: WpgColor = { r: 0, g: 0, b: 0, a: 0 };

// The running geometry every decoded coordinate converts through: the image extent in points (the page size and the Y-flip reference), the pixels-per-inch of each axis, and the coordinate precision Start WPG stated.
interface WpgGeometry {
  readonly widthPt: number;
  readonly heightPt: number;
  readonly xPpi: number;
  readonly yPpi: number;
  readonly doublePrecision: boolean;
  readonly coordinateSize: number;
}

// One grouped record's bookkeeping for the walk: how many member records are still to arrive, and whether those members walk as records in their own right (a Group's are independent objects, and a decoded Text Block's single Text Data member is its payload, which the walk folds through the Text Data case) or are swallowed with their opener (every grouped record this reader skipped whole).
interface WpgGroupContext {
  remaining: number;
  readonly membersWalk: boolean;
}

// A count field, the variable-length integer every record header's Extension and Length fields use: a byte 0-0xFE is the value; 0xFF introduces a 16-bit value, whose own high bit set introduces a further 16-bit low half (the SDK's 1/3/5-byte coding).
function readCountField(
  bytes: Uint8Array,
  cursor: number,
): { readonly value: number; readonly next: number } | undefined {
  const first = bytes[cursor];
  if (first === undefined) {
    return undefined;
  }
  if (first <= 0xfe) {
    return { value: first, next: cursor + 1 };
  }
  if (cursor + 3 > bytes.length) {
    return undefined;
  }
  const shortValue = uint16At(bytes, cursor + 1);
  if ((shortValue & 0x8000) === 0) {
    return { value: shortValue, next: cursor + 3 };
  }
  if (cursor + 5 > bytes.length) {
    return undefined;
  }
  const lowHalf = uint16At(bytes, cursor + 3);
  return { value: ((shortValue & 0x7fff) << 16) + lowHalf, next: cursor + 5 };
}

// Reads one coordinate at the stream's stated precision: a signed 16-bit unit in single precision, a 32-bit 16.16 fixed-point value in double ("Corel products use the fractional portion for rounding only", so the fraction is kept rather than truncated).
function coordinateAt(
  bytes: Uint8Array,
  offset: number,
  doublePrecision: boolean,
): number {
  if (!doublePrecision) {
    return int16At(bytes, offset);
  }
  return uint32At(bytes, offset) / 0x10000;
}

// The characterisation flags word plus the walk past the optional data its low bits state -- exactly as far as this decoder needs: past the edit-lock descriptor and the Object ID. A record carrying any transformation flag (taper/translate/skew/scale/rotate) is refused whole, so the transformation elements themselves are never walked past. The returned `geometryAt` of -1 is the refusal marker; a flags word whose optional data runs past the record's own end cannot be stepped over, and also refuses.
function readCharacterization(
  bytes: Uint8Array,
  cursor: number,
  recordEnd: number,
): { readonly flags: number; readonly geometryAt: number } | undefined {
  if (cursor + 2 > recordEnd) {
    return undefined;
  }
  const flags = uint16At(bytes, cursor);
  const transformationFlags =
    FLAG_TAPER | FLAG_TRANSLATE | FLAG_SKEW | FLAG_SCALE | FLAG_ROTATE;
  if ((flags & transformationFlags) !== 0) {
    return { flags, geometryAt: -1 };
  }
  let geometryAt = cursor + 2;
  if ((flags & FLAG_EDIT_LOCK) !== 0) {
    geometryAt += 4;
  }
  if ((flags & FLAG_OBJECT_ID) !== 0) {
    if (geometryAt + 2 > recordEnd) {
      return undefined;
    }
    // An Object ID is a short, or a long when the short's high bit is set.
    geometryAt += (uint16At(bytes, geometryAt) & 0x8000) !== 0 ? 4 : 2;
  }
  if (geometryAt > recordEnd) {
    return undefined;
  }
  return { flags, geometryAt };
}

function xToPt(geometry: WpgGeometry, x: number): number {
  return (x / geometry.xPpi) * POINTS_PER_INCH;
}

// WPG's Y grows up from the extent's bottom; the shared model's grows down from the page top. Flipping against the extent height converts one to the other.
function yToPt(geometry: WpgGeometry, y: number): number {
  return geometry.heightPt - (y / geometry.yPpi) * POINTS_PER_INCH;
}

function strokeOf(
  geometry: WpgGeometry,
  state: WpgRenditionState,
): ContentStroke | undefined {
  if (state.penWidthUnits <= 0) {
    return undefined;
  }
  const opacity = 1 - state.penColor.a;
  return {
    color: { r: state.penColor.r, g: state.penColor.g, b: state.penColor.b },
    widthPt: (state.penWidthUnits / geometry.xPpi) * POINTS_PER_INCH,
    ...(opacity < 1 ? { opacity } : {}),
  };
}

function fillOf(state: WpgRenditionState): {
  fill: Color;
  fillOpacity: number;
} {
  return {
    fill: {
      r: state.brushColor.r,
      g: state.brushColor.g,
      b: state.brushColor.b,
    },
    fillOpacity: 1 - state.brushColor.a,
  };
}

// A single-precision colour record: four bytes, red first, then green, blue, and transparency ("where 255 is 100%").
function readSingleColor(data: Uint8Array): WpgColor | undefined {
  if (data.length < 4) {
    return undefined;
  }
  return {
    r: byteAt(data, 0) / 255,
    g: byteAt(data, 1) / 255,
    b: byteAt(data, 2) / 255,
    a: byteAt(data, 3) / 255,
  };
}

// A double-precision colour record: the same four components as shorts on the same 0..1 scale, 65535 standing for 100%.
function readDoubleColor(data: Uint8Array): WpgColor | undefined {
  if (data.length < 8) {
    return undefined;
  }
  return {
    r: uint16At(data, 0) / 65535,
    g: uint16At(data, 2) / 65535,
    b: uint16At(data, 4) / 65535,
    a: uint16At(data, 6) / 65535,
  };
}

// Decodes a WPG 2.x record stream into the shared drawing vocabulary. Returns undefined only when the bytes carry no WPG graphic at all (no signature with the WPG product and file-type bytes); a recognised graphic that does not decode answers `refused` with its reason, and a decoded one carries whatever subset of its records this reader understands plus the names of the rest.
export function decodeWpgGraphic(
  bytes: Uint8Array,
  options: { readonly foldTextData: WpgTextFold },
): WpgDecode | undefined {
  // The signature scan mirrors stream/image.ts's magic-driven discipline: a child packet's container spelling is not specified by the prefix-packet catalogue, so the WPG prefix is located by its file ID and confirmed by the prefix's own product and file-type gates rather than by assuming an offset.
  let start = -1;
  for (
    let index = 0;
    index + WPG_PREFIX_HEAD_SIZE <= bytes.length;
    index += 1
  ) {
    if (
      byteAt(bytes, index) !== 0xff ||
      byteAt(bytes, index + 1) !== 0x57 ||
      byteAt(bytes, index + 2) !== 0x50 ||
      byteAt(bytes, index + 3) !== 0x43
    ) {
      continue;
    }
    if (
      byteAt(bytes, index + 8) !== WPG_PRODUCT_TYPE ||
      byteAt(bytes, index + 9) !== WPG_FILE_TYPE
    ) {
      continue;
    }
    start = index;
    break;
  }
  if (start < 0) {
    return undefined;
  }
  const majorVersion = byteAt(bytes, start + 10);
  if (majorVersion === WPG_MAJOR_1) {
    return { status: "refused", reason: "wpg1" };
  }
  if (majorVersion !== WPG_MAJOR_2) {
    return { status: "refused", reason: "malformed" };
  }
  if (uint16At(bytes, start + 12) !== 0) {
    return { status: "refused", reason: "encrypted" };
  }
  const recordStart = uint32At(bytes, start + 4);
  if (
    recordStart < start + WPG_PREFIX_HEAD_SIZE ||
    recordStart >= bytes.length
  ) {
    return { status: "refused", reason: "malformed" };
  }

  const state: WpgRenditionState = {
    penColor: { ...WPG_DEFAULT_BLACK },
    penWidthUnits: 0,
    brushColor: { ...WPG_DEFAULT_BLACK },
  };
  const vectors: ContentVector[] = [];
  const shapes: ContentShape[] = [];
  const skipped = new Set<string>();
  const groups: WpgGroupContext[] = [];
  let geometry: WpgGeometry | undefined;
  let paintOrder = 0;
  // A Text Block's frame, waiting for the Text Data extension record that follows it to supply the body. Cleared by any other record, so a Text Data arriving after something else (or none at all) is a Text Line's or Text Path's payload this reader has no frame for.
  let pendingTextBlockFrame: Box | undefined;
  let cursor = start + recordStart;

  const recordName = (type: number): string =>
    RECORD_NAMES.get(type) ?? `record type 0x${type.toString(16)}`;

  // Stryker disable next-line EqualityOperator: at the exact tie (cursor === bytes.length) the loop body's own very first check (cursor + 2 > bytes.length) is also true, breaking immediately either way -- so entering the loop body one extra time at this tie changes nothing observable.
  while (cursor < bytes.length) {
    // Stryker disable next-line EqualityOperator: at the exact tie (cursor + 2 === bytes.length) the 2-byte Class/Type header is read successfully either way, but with nothing left afterwards readCountField's own first byte read returns undefined immediately, breaking the walk on the very next check regardless of which operator gates this one.
    if (cursor + 2 > bytes.length) {
      break;
    }
    const type = byteAt(bytes, cursor + 1);
    let after = cursor + 2;
    const extension = readCountField(bytes, after);
    if (extension === undefined) {
      break;
    }
    after = extension.next;
    const length = readCountField(bytes, after);
    if (length === undefined) {
      break;
    }
    after = length.next;
    const recordEnd = after + length.value;
    if (recordEnd > bytes.length) {
      // A length that runs past the buffer is a truncated graphic: the walk stops with what it decoded rather than reading the tail as rubbish.
      break;
    }
    const data = bytes.subarray(after, recordEnd);

    // The group bookkeeping: this record consumes one member slot of the innermost open group, a group whose last member just arrived closes before this record can open one of its own, and a record with members opens a new context -- a Group's members independent objects walked as their own records, a decoded Text Block's Text Data member walked as its payload, every other grouped record's members swallowed with their opener.
    const innermostBefore = groups[groups.length - 1];
    if (innermostBefore !== undefined) {
      innermostBefore.remaining -= 1;
    }
    const swallowed = swallowedByOpenGroup(groups);

    if (type === RECORD_END_WPG && !swallowed) {
      break;
    }

    if (!swallowed) {
      switch (type) {
        case RECORD_START_WPG: {
          // [h units/inch][v units/inch]<precision>[viewport 4 coords][extent 4 coords][next Object ID]. The viewport is a clipping rectangle this reader does not model and the next-Object-ID field is editing state; both are stepped over by the record's own length.
          if (data.length < 13) {
            skipped.add(recordName(type));
            break;
          }
          const xPpi = uint16At(data, 0);
          const yPpi = uint16At(data, 2);
          const precision = byteAt(data, 4);
          if (
            xPpi === 0 ||
            yPpi === 0 ||
            (precision !== 0 && precision !== 1)
          ) {
            return { status: "refused", reason: "malformed" };
          }
          const doublePrecision = precision === 1;
          const coordinateSize = doublePrecision ? 4 : 2;
          const extentAt = 5 + coordinateSize * 4;
          if (extentAt + coordinateSize * 4 > data.length) {
            return { status: "refused", reason: "malformed" };
          }
          const left = coordinateAt(data, extentAt, doublePrecision);
          const bottom = coordinateAt(
            data,
            extentAt + coordinateSize,
            doublePrecision,
          );
          const right = coordinateAt(
            data,
            extentAt + coordinateSize * 2,
            doublePrecision,
          );
          const top = coordinateAt(
            data,
            extentAt + coordinateSize * 3,
            doublePrecision,
          );
          geometry = {
            widthPt: (Math.abs(right - left) / xPpi) * POINTS_PER_INCH,
            heightPt: (Math.abs(top - bottom) / yPpi) * POINTS_PER_INCH,
            xPpi,
            yPpi,
            doublePrecision,
            coordinateSize,
          };
          break;
        }
        case RECORD_PEN_FORE_COLOR:
        case RECORD_DP_PEN_FORE_COLOR: {
          const color =
            type === RECORD_PEN_FORE_COLOR
              ? readSingleColor(data)
              : readDoubleColor(data);
          if (color !== undefined) {
            state.penColor = color;
          }
          break;
        }
        case RECORD_BRUSH_FORE_COLOR:
        case RECORD_DP_BRUSH_FORE_COLOR: {
          const color =
            type === RECORD_BRUSH_FORE_COLOR
              ? readSingleColor(data)
              : readDoubleColor(data);
          if (color !== undefined) {
            state.brushColor = color;
          }
          break;
        }
        case RECORD_PEN_SIZE: {
          if (data.length >= 4) {
            state.penWidthUnits = uint16At(data, 0);
          }
          break;
        }
        case RECORD_DP_PEN_SIZE: {
          if (data.length >= 8) {
            state.penWidthUnits = uint32At(data, 0) / 0x10000;
          }
          break;
        }
        case RECORD_TEXT_BLOCK: {
          pendingTextBlockFrame = readTextBlockFrame(data, geometry);
          if (pendingTextBlockFrame === undefined) {
            skipped.add(recordName(type));
          }
          break;
        }
        case RECORD_TEXT_DATA: {
          const frame = pendingTextBlockFrame;
          pendingTextBlockFrame = undefined;
          if (frame === undefined) {
            // A Text Data with no Text Block before it is a Text Line's or Text Path's payload -- both records this reader skips -- so it is named with them rather than decoded against a frame nothing stated.
            skipped.add(recordName(type));
            break;
          }
          const blocks = options.foldTextData(data);
          shapes.push({
            frame,
            insetLeftPt: 0,
            insetTopPt: 0,
            insetRightPt: 0,
            insetBottomPt: 0,
            blocks: [...blocks],
            paintOrder,
          });
          paintOrder += 1;
          break;
        }
        case RECORD_GROUP:
          // A Group carries no geometry of its own; its members walk as the records that follow it.
          break;
        default: {
          const vector =
            geometry === undefined
              ? undefined
              : readPrimitiveVector(type, data, geometry, state);
          if (vector === undefined) {
            skipped.add(recordName(type));
          } else {
            // WPG paints in record order, and paintOrder is the shared cross-array z-ordering hint, so both result arrays number from one counter in the order their records arrived.
            vectors.push({ ...vector, paintOrder });
            paintOrder += 1;
          }
          break;
        }
      }
      if (type !== RECORD_TEXT_BLOCK) {
        pendingTextBlockFrame = undefined;
      }
    }

    // Stryker disable next-line ConditionalExpression,EqualityOperator: forcing the length check to always-true, or weakening > to >=, only ever matters when groups is empty (length 0) -- and there, `groups[groups.length - 1]` is already `groups[-1]`, so the optional-chained `?.remaining === 0` on the right independently evaluates to `undefined === 0`, false, regardless of the left operand. Both mutants agree with the original on every input.
    while (groups.length > 0 && groups[groups.length - 1]?.remaining === 0) {
      groups.pop();
    }
    if (extension.value > 0) {
      // A Group's members are independent objects, and a decoded Text Block's Text Data member is the payload the switch folds -- both walk. Every other grouped record's members belong to their opener, so if the opener was skipped (or was itself swallowed) they are swallowed with it.
      groups.push({
        remaining: extension.value,
        membersWalk:
          !swallowed &&
          (type === RECORD_GROUP ||
            (type === RECORD_TEXT_BLOCK &&
              pendingTextBlockFrame !== undefined)),
      });
    }
    cursor = recordEnd;
  }

  if (geometry === undefined) {
    return { status: "refused", reason: "malformed" };
  }
  return {
    status: "decoded",
    sizePt: { widthPt: geometry.widthPt, heightPt: geometry.heightPt },
    vectors,
    shapes,
    skippedRecords: [...skipped],
  };
}

// Whether the record about to be handled sits inside a group whose members are swallowed rather than walked: its DIRECT parent decides -- the innermost context open at the moment the record arrives, exactly as the nesting rule states (a grouped logical record counts as one member of the group outside it). The one shape this rule cannot express is a Group nested inside a swallowed group, whose members would walk as top-level records; the specification's own extension lists name no such shape (a Compound Polygon's or Chart's members are path, rendition, and data records, never Groups).
function swallowedByOpenGroup(groups: readonly WpgGroupContext[]): boolean {
  const innermost = groups[groups.length - 1];
  return innermost !== undefined && !innermost.membersWalk;
}

// A Text Block's frame: [flags][Xll][Yll][Xur][Yur] at the stream's precision.
function readTextBlockFrame(
  data: Uint8Array,
  geometry: WpgGeometry | undefined,
): Box | undefined {
  if (geometry === undefined) {
    return undefined;
  }
  const characterization = readCharacterization(data, 0, data.length);
  if (
    characterization === undefined ||
    // Stryker disable next-line EqualityOperator: readCharacterization is always called with cursor 0 here, so its own geometryAt is either the -1 refusal sentinel or cursor + 2 (at least 2); it can never be exactly 0, so < and <= agree on every reachable value.
    characterization.geometryAt < 0 ||
    characterization.geometryAt + geometry.coordinateSize * 4 > data.length
  ) {
    return undefined;
  }
  const at = characterization.geometryAt;
  return frameFromCorners(
    geometry,
    coordinateAt(data, at, geometry.doublePrecision),
    coordinateAt(data, at + geometry.coordinateSize, geometry.doublePrecision),
    coordinateAt(
      data,
      at + geometry.coordinateSize * 2,
      geometry.doublePrecision,
    ),
    coordinateAt(
      data,
      at + geometry.coordinateSize * 3,
      geometry.doublePrecision,
    ),
  );
}

// The shared frame for two WPG corners (lower-left and upper-right, Y up): normalised and converted to the model's top-left-origin, Y-down page space, in points. yToPt has already performed the one flip against the extent height, so the smaller converted Y is the frame's top edge -- subtracting it from heightPt again would flip it back into Y-up space.
function frameFromCorners(
  geometry: WpgGeometry,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Box {
  const left = Math.min(xToPt(geometry, x1), xToPt(geometry, x2));
  const right = Math.max(xToPt(geometry, x1), xToPt(geometry, x2));
  const top = Math.min(yToPt(geometry, y1), yToPt(geometry, y2));
  const bottom = Math.max(yToPt(geometry, y1), yToPt(geometry, y2));
  return {
    xPt: left,
    yPt: top,
    widthPt: right - left,
    heightPt: bottom - top,
  };
}

// The primitive records that decode to a ContentVector: Polyline, Rectangle, and Arc-as-full-ellipse. Returns undefined for any other type, for a record this reader must refuse (transformation flags, truncated data, a partial arc), leaving the caller to name it.
function readPrimitiveVector(
  type: number,
  data: Uint8Array,
  geometry: WpgGeometry,
  state: WpgRenditionState,
): ContentVector | undefined {
  const characterization = readCharacterization(data, 0, data.length);
  // Stryker disable next-line EqualityOperator: readCharacterization is always called with cursor 0 here, so its own geometryAt is either the -1 refusal sentinel or cursor + 2 (at least 2); it can never be exactly 0, so < and <= agree on every reachable value.
  if (characterization === undefined || characterization.geometryAt < 0) {
    return undefined;
  }
  const { flags, geometryAt } = characterization;
  const stroke =
    (flags & FLAG_FRAME) !== 0 ? strokeOf(geometry, state) : undefined;
  switch (type) {
    case RECORD_POLYLINE:
      return readPolyline(data, geometry, flags, geometryAt, stroke, state);
    case RECORD_RECTANGLE:
      return readWpgRectangle(data, geometry, flags, geometryAt, stroke, state);
    case RECORD_ARC:
      return readWpgFullEllipse(
        data,
        geometry,
        flags,
        geometryAt,
        stroke,
        state,
      );
    default:
      return undefined;
  }
}

function readPolyline(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  // Stryker disable next-line EqualityOperator: at the exact tie (geometryAt + 2 === data.length) the count field is read successfully either way -- but with zero bytes left for any point, a count of 0 empties `points` (refused below, no first point) and a count > 0 immediately fails the per-point room check on its first iteration, so both operators end in the identical refusal.
  if (geometryAt + 2 > data.length) {
    return undefined;
  }
  const count = uint16At(data, geometryAt);
  let at = geometryAt + 2;
  const points: { xPt: number; yPt: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + geometry.coordinateSize * 2 > data.length) {
      return undefined;
    }
    points.push({
      xPt: xToPt(geometry, coordinateAt(data, at, geometry.doublePrecision)),
      yPt: yToPt(
        geometry,
        coordinateAt(
          data,
          at + geometry.coordinateSize,
          geometry.doublePrecision,
        ),
      ),
    });
    at += geometry.coordinateSize * 2;
  }
  const firstPoint = points[0];
  if (firstPoint === undefined) {
    return undefined;
  }
  const secondPoint = points[1];
  const closed = (flags & FLAG_CLOSE) !== 0;
  const filled = (flags & FLAG_FILL) !== 0;

  // Two points, not closed, is the shared model's own line variant -- the shape a plain stroke draws -- when a stroke resolved for it (the variant carries a required stroke, and a hairline-framed line keeps its geometry as a path instead).
  if (
    points.length === 2 &&
    secondPoint !== undefined &&
    !closed &&
    stroke !== undefined
  ) {
    return {
      kind: "line",
      from: firstPoint,
      to: secondPoint,
      stroke,
    };
  }

  // A path's subpath points are local to its own frame (the shared path variant's contract), so the bounding box of the converted points becomes the frame and each point shifts by its origin.
  const frame = boundingFrame(points);
  const local = points.map((point) => ({
    xPt: point.xPt - frame.xPt,
    yPt: point.yPt - frame.yPt,
  }));
  const subpath: ContentSubpath = {
    start: {
      xPt: firstPoint.xPt - frame.xPt,
      yPt: firstPoint.yPt - frame.yPt,
    },
    segments: local
      .slice(1)
      .map((point) => ({ kind: "line" as const, to: point })),
    closed,
  };
  const fill = filled ? fillOf(state) : undefined;
  return {
    kind: "path",
    frame,
    subpaths: [subpath],
    ...(fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
          ...((flags & FLAG_PATH_WINDING) !== 0
            ? { fillRule: "nonzero" as const }
            : {}),
        }
      : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
}

function boundingFrame(points: readonly { xPt: number; yPt: number }[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.xPt);
    minY = Math.min(minY, point.yPt);
    maxX = Math.max(maxX, point.xPt);
    maxY = Math.max(maxY, point.yPt);
  }
  return { xPt: minX, yPt: minY, widthPt: maxX - minX, heightPt: maxY - minY };
}

function readWpgRectangle(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  const coordinateSize = geometry.coordinateSize;
  if (geometryAt + coordinateSize * 6 > data.length) {
    return undefined;
  }
  const xll = coordinateAt(data, geometryAt, geometry.doublePrecision);
  const yll = coordinateAt(
    data,
    geometryAt + coordinateSize,
    geometry.doublePrecision,
  );
  const xur = coordinateAt(
    data,
    geometryAt + coordinateSize * 2,
    geometry.doublePrecision,
  );
  const yur = coordinateAt(
    data,
    geometryAt + coordinateSize * 3,
    geometry.doublePrecision,
  );
  const rx = coordinateAt(
    data,
    geometryAt + coordinateSize * 4,
    geometry.doublePrecision,
  );
  const ry = coordinateAt(
    data,
    geometryAt + coordinateSize * 5,
    geometry.doublePrecision,
  );
  const frame = frameFromCorners(geometry, xll, yll, xur, yur);
  const filled = (flags & FLAG_FILL) !== 0;
  const fill = filled ? fillOf(state) : undefined;
  const fillFields =
    fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
        }
      : {};

  // "If either the horizontal radius or the vertical radius is less than or equal to zero, then the corner is assumed to be square" -- the plain rect the shared model carries directly.
  if (rx <= 0 || ry <= 0) {
    return {
      kind: "rect",
      frame,
      ...fillFields,
      ...(stroke !== undefined ? { stroke } : {}),
    };
  }

  // A genuinely rounded rectangle: the shared rect variant carries no corner radii, so the shape becomes a path whose corners are the quarter-ellipse cubics named at this module's head. The path starts at the nine o'clock position the specification itself defines for a rectangle's path, and the subpath points are local to the frame as the path variant's own contract states. A corner radius is a magnitude, not a position, so only the unit conversion applies -- running one through yToPt would flip it against an extent height it never measured from -- and each radius clamps to half its side so a radius larger than the rectangle itself still yields a path inside the frame, with the cubic control offsets derived from the clamped values to match.
  const cornerRxPt = Math.min(
    (rx / geometry.xPpi) * POINTS_PER_INCH,
    frame.widthPt / 2,
  );
  const cornerRyPt = Math.min(
    (ry / geometry.yPpi) * POINTS_PER_INCH,
    frame.heightPt / 2,
  );
  const kx = cornerRxPt * QUARTER_ELLIPSE_KAPPA;
  const ky = cornerRyPt * QUARTER_ELLIPSE_KAPPA;
  const width = frame.widthPt;
  const height = frame.heightPt;
  const left = { xPt: 0, yPt: height / 2 };
  return {
    kind: "path",
    frame,
    subpaths: [
      {
        start: left,
        closed: true,
        segments: [
          { kind: "line", to: { xPt: cornerRxPt, yPt: 0 } },
          {
            kind: "cubic",
            control1: { xPt: cornerRxPt - kx, yPt: 0 },
            control2: { xPt: width, yPt: cornerRyPt - ky },
            to: { xPt: width, yPt: cornerRyPt },
          },
          { kind: "line", to: { xPt: width, yPt: height - cornerRyPt } },
          {
            kind: "cubic",
            control1: { xPt: width, yPt: height - cornerRyPt + ky },
            control2: { xPt: width - cornerRxPt + kx, yPt: height },
            to: { xPt: width - cornerRxPt, yPt: height },
          },
          { kind: "line", to: { xPt: cornerRxPt, yPt: height } },
          {
            kind: "cubic",
            control1: { xPt: cornerRxPt - kx, yPt: height },
            control2: { xPt: 0, yPt: height - cornerRyPt + ky },
            to: { xPt: 0, yPt: height - cornerRyPt },
          },
          { kind: "line", to: { xPt: 0, yPt: cornerRyPt } },
          {
            kind: "cubic",
            control1: { xPt: 0, yPt: cornerRyPt - ky },
            control2: { xPt: cornerRxPt - kx, yPt: 0 },
            to: { xPt: cornerRxPt, yPt: 0 },
          },
          { kind: "line", to: left },
        ],
      },
    ],
    ...fillFields,
    ...(stroke !== undefined ? { stroke } : {}),
  };
}

// An Arc record whose initial and terminal endpoint offsets are identical: "Identical endpoint coordinates define a full ellipse or circle" -- the only arc spelling this decoder lifts, since a partial elliptical arc has no exact segment shape in the shared path model (whose cubics would approximate, not carry, it). Any other arc is refused and named.
function readWpgFullEllipse(
  data: Uint8Array,
  geometry: WpgGeometry,
  flags: number,
  geometryAt: number,
  stroke: ContentStroke | undefined,
  state: WpgRenditionState,
): ContentVector | undefined {
  const coordinateSize = geometry.coordinateSize;
  if (geometryAt + coordinateSize * 8 + 1 > data.length) {
    return undefined;
  }
  const cx = coordinateAt(data, geometryAt, geometry.doublePrecision);
  const cy = coordinateAt(
    data,
    geometryAt + coordinateSize,
    geometry.doublePrecision,
  );
  const rx = coordinateAt(
    data,
    geometryAt + coordinateSize * 2,
    geometry.doublePrecision,
  );
  const ry = coordinateAt(
    data,
    geometryAt + coordinateSize * 3,
    geometry.doublePrecision,
  );
  const ix = coordinateAt(
    data,
    geometryAt + coordinateSize * 4,
    geometry.doublePrecision,
  );
  const iy = coordinateAt(
    data,
    geometryAt + coordinateSize * 5,
    geometry.doublePrecision,
  );
  const ex = coordinateAt(
    data,
    geometryAt + coordinateSize * 6,
    geometry.doublePrecision,
  );
  const ey = coordinateAt(
    data,
    geometryAt + coordinateSize * 7,
    geometry.doublePrecision,
  );
  if (ix !== ex || iy !== ey) {
    return undefined;
  }
  const frame = frameFromCorners(geometry, cx - rx, cy - ry, cx + rx, cy + ry);
  const filled = (flags & FLAG_FILL) !== 0;
  const fill = filled ? fillOf(state) : undefined;
  return {
    kind: "ellipse",
    frame,
    ...(fill !== undefined
      ? {
          fill: fill.fill,
          ...(fill.fillOpacity < 1 ? { fillOpacity: fill.fillOpacity } : {}),
        }
      : {}),
    ...(stroke !== undefined ? { stroke } : {}),
  };
}
