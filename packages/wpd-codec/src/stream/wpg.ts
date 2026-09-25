import type {
  Box,
  Color,
  ContentBlock,
  ContentShape,
  ContentStroke,
  ContentVector,
  PageSize,
} from "document-schema.js";
import { byteAt, int16At, uint16At, uint32At } from "../bytes/view";
import { readPrimitiveVector } from "./wpg-primitives";

// Offsets inside the 26-byte WPG prefix header, past the 4-byte file ID: the record-start long, the product type and file type bytes, the major version, and the encryption flag word.
const PREFIX_RECORD_START_OFFSET = 4;
const PREFIX_PRODUCT_TYPE_OFFSET = 8;
const PREFIX_FILE_TYPE_OFFSET = 9;
const PREFIX_MAJOR_VERSION_OFFSET = 10;
const PREFIX_ENCRYPTION_FLAG_OFFSET = 12;

// A Start WPG record needs its two units-per-inch words, the precision byte, and the four viewport coordinates before the extent is even reachable; the extent sits after those five bytes, and its own four coordinates (left, bottom, right, top) follow, with the extent's first coordinate three viewport steps past its start.
const START_WPG_MIN_SIZE = 13;
const START_WPG_PRECISION_OFFSET = 4;
const RGBA_ALPHA_OFFSET = 3;
const WPG_FILE_ID_LAST = 3;
const START_WPG_EXTENT_OFFSET = 5;
const VIEWPORT_COORDINATE_COUNT = 4;
const EXTENT_FIRST_COORDINATE = 3;
const RGBA_ALPHA_16_OFFSET = 6;
const HEX_RADIX = 16;

// The WPG integer encoding's own bounds: a value up to 0xfe is itself, a following short is a 16-bit value, and a short with its top bit set escapes to a 30-bit long spread across both halves.
const WPG_INTEGER_DIRECT_MAX = 0xfe;
const WPG_SHORT_INTEGER_SIZE = 3;
const WPG_LONG_INTEGER_SIZE = 5;
const WPG_LONG_ESCAPE_MASK = 0x8000;
const WPG_LONG_VALUE_MASK = 0x7fff;
const USHORT_BITS = 16;
const USHORT_FIELD_SIZE = 2;
const ULONG_FIELD_SIZE = 4;
const EDIT_LOCK_FIELD_SIZE = 4;

// Double-precision coordinates are 16.16 fixed point.
const FIXED_POINT_ONE = 0x10000;

// Colour channels as the document model wants them: a 0..1 fraction of the type's own maximum.
const RGBA_COMPONENT_COUNT = 4;
const RGBA16_BYTE_LENGTH = 8;
const USHORT_BYTES = 2;
const UINT8_MAX = 255;
const UINT16_MAX = 65535;

// The WPG file ID, spelled as the four bytes it is compared against.
const WPG_FILE_ID = Array.from("\u00ffWPC", (char) => char.charCodeAt(0));

// — WPG (WordPerfect Graphic) vector graphics, per the SDK's "WordPerfect Graphic File Format" pages --
//
// A WPG file opens with the same 26-byte prefix family a WordPerfect document does (file ID FF 57 50 43, a long pointer to the data, product/file-type/version bytes), distinguished from a document by its file-type byte 22 (0x16). From the pointer onwards it is an ordered sequence of drawing records: a header of Class (1 byte), Type (1 byte), Extension (a count field, 1/3/5 bytes), and Length (the same count-field coding), then exactly Length bytes of data. The Extension count groups physical records into logical ones — a record whose count is N is followed by N more records belonging to it, and a grouped logical record counts as one record to the next outermost group's count. A Group record's children are independent objects each with their own attributes; every other grouped record's children belong to their opener (a Text Block's Text Data, a Bitmap's palette and data, a Compound Polygon's paths), so when this reader skips a grouped record it skips the whole group and walks on only after that group's members have passed. The one opener whose member still walks after a successful decode is the Text Block: its Text Data extension is the payload itself, folded through the injected WP fold rather than skipped with it.
//
// THE SCOPE OF THIS DECODER, stated because a WPG record stream has a long tail and this is deliberately a layered subset, not "WPG support": decoded are the record framing itself; Start WPG (the units, precision, and image extent every coordinate conversion needs); the flat colour and weight attributes (Pen Fore Color, Pen Size, Brush Fore Color, and their double-precision variants); and the common primitives — Polyline (two unclosed points as the shared model's own line variant when a stroke resolved, more points as a path, a closed one as a closed subpath), Rectangle (square corners as a rect, rounded corners as a path of kappa-approximated quarter-ellipses), Arc with identical endpoint offsets (the full ellipse the specification itself defines that spelling to mean), and Text Block with its Text Data extension (a WP document stream, folded through this package's own tokeniser and fold via the callback the caller injects). Every other record type is recognised by the walk, skipped whole, and named in the diagnostic the caller reports — among them Polyspline, Polycurve, Compound Polygon, Bitmap, Bitmap Data, Text Line, Text Path, Chart and its style/data companions, Object Image, Object Capsule, the pen style/pattern and brush pattern/gradient/texture families (a non-flat pen or brush pattern has no flat colour this reader could honestly approximate it with), and the page-settings records. A record carrying a transformation in its characterisation flags (taper, translate, skew, scale, or rotate) is skipped rather than decoded with the transformation dropped — its geometry would be wrong, not partial. WPG 1.0-major files are refused outright: that is a separate record vocabulary (type byte and length only, no class or extension fields, palette-indexed colours, 1200ths-of-an-inch units) which the vendor pages this package builds from do not document, and misparsing one as WPG 2.x would decode rubbish rather than refuse.
//
// Coordinates are single precision (signed 16-bit) or double precision (32-bit 16.16 fixed point) per Start WPG's own precision byte, in units of the Start WPG record's pixels-per-inch, with Y increasing upward from a bottom-left origin. The shared vector model is top-left origin, Y down, in points — so every coordinate divides by the pixels-per-inch and multiplies by 72, and every Y flips against the image extent's height.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_1graph.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_2g-rec.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/b_4g-txt.htm

// The record types this decoder gives a meaning to. Every other type number the walk meets is skipped and named through the caller's diagnostic.
const RECORD_START_WPG = 0x01;
const RECORD_END_WPG = 0x02;
const RECORD_TEXT_DATA = 0x0f;
export const RECORD_POLYLINE = 0x15;
export const RECORD_RECTANGLE = 0x18;
export const RECORD_ARC = 0x19;
const RECORD_TEXT_BLOCK = 0x1d;
const RECORD_GROUP = 0x20;
const RECORD_PEN_FORE_COLOR = 0x25;
const RECORD_DP_PEN_FORE_COLOR = 0x26;
const RECORD_PEN_SIZE = 0x2b;
const RECORD_DP_PEN_SIZE = 0x2c;
const RECORD_BRUSH_FORE_COLOR = 0x31;
const RECORD_DP_BRUSH_FORE_COLOR = 0x32;

// The record names reported for skipped records, keyed by type number so the diagnostic can name exactly what a given file carried. Only the types the specification names are listed; an unknown type number reports its number. The types this decoder otherwise gives a meaning to appear here too, because each has a spelling that refuses it (a Start WPG too short to carry an extent, a Text Data with no Text Block before it, a Polyline or Rectangle carrying a transformation, a partial Arc) and a refusal that names its record is the contract the caller's diagnostic reports.
// The WPG spec's own function numbers, one constant per record type, keyed here so a skipped-record diagnostic names what the file carried.
const WPG_START_WPG = 0x01;
const WPG_FORM_SETTINGS = 0x03;
const WPG_RULER_SETTINGS = 0x04;
const WPG_GRID_SETTINGS = 0x05;
const WPG_LAYER = 0x06;
const WPG_OBJECTLINK = 0x07;
const WPG_PEN_STYLE_DEFINITION = 0x08;
const WPG_PATTERN_DEFINITION = 0x09;
const WPG_COMMENT = 0x0a;
const WPG_COLOR_TRANSFER = 0x0b;
const WPG_COLOR_PALETTE = 0x0c;
const WPG_DP_COLOR_PALETTE = 0x0d;
const WPG_BITMAP_DATA = 0x0e;
const WPG_TEXT_DATA = 0x0f;
const WPG_CHART_STYLE = 0x10;
const WPG_CHART_DATA = 0x11;
const WPG_OBJECT_IMAGE = 0x12;
const WPG_POLYLINE = 0x15;
const WPG_POLYSPLINE = 0x16;
const WPG_POLYCURVE = 0x17;
const WPG_RECTANGLE = 0x18;
const WPG_ARC = 0x19;
const WPG_COMPOUND_POLYGON = 0x1a;
const WPG_BITMAP = 0x1b;
const WPG_TEXT_LINE = 0x1c;
const WPG_TEXT_BLOCK = 0x1d;
const WPG_TEXT_PATH = 0x1e;
const WPG_CHART = 0x1f;
const WPG_OBJECT_CAPSULE = 0x21;
const WPG_FONT_SETTINGS = 0x22;
const WPG_PEN_BACK_COLOR = 0x27;
const WPG_DP_PEN_BACK_COLOR = 0x28;
const WPG_PEN_STYLE = 0x29;
const WPG_PEN_PATTERN = 0x2a;
const WPG_LINE_CAP = 0x2d;
const WPG_LINE_JOIN = 0x2e;
const WPG_BRUSH_GRADIENT = 0x2f;
const WPG_DP_BRUSH_GRADIENT = 0x30;
const WPG_BRUSH_BACK_COLOR = 0x33;
const WPG_DP_BRUSH_BACK_COLOR = 0x34;
const WPG_BRUSH_PATTERN = 0x35;
const WPG_HORIZONTAL_LINE = 0x36;
const WPG_VERTICAL_LINE = 0x37;
const WPG_POSTER_SETTINGS = 0x38;
const WPG_IMAGE_STATE = 0x39;
const WPG_ENVELOPE_DEFINITION = 0x3a;
const WPG_ENVELOPE = 0x3b;
const WPG_TEXTURE_DEFINITION = 0x3c;
const WPG_BRUSH_TEXTURE = 0x3d;
const WPG_TEXTURE_ALIGNMENT = 0x3e;
const WPG_PEN_TEXTURE = 0x3f;

const RECORD_NAMES: ReadonlyMap<number, string> = new Map([
  [WPG_START_WPG, "Start WPG"],
  [WPG_FORM_SETTINGS, "Form Settings"],
  [WPG_RULER_SETTINGS, "Ruler Settings"],
  [WPG_GRID_SETTINGS, "Grid Settings"],
  [WPG_LAYER, "Layer"],
  [WPG_OBJECTLINK, "ObjectLink"],
  [WPG_PEN_STYLE_DEFINITION, "Pen Style Definition"],
  [WPG_PATTERN_DEFINITION, "Pattern Definition"],
  [WPG_COMMENT, "Comment"],
  [WPG_COLOR_TRANSFER, "Color Transfer"],
  [WPG_COLOR_PALETTE, "Color Palette"],
  [WPG_DP_COLOR_PALETTE, "DP Color Palette"],
  [WPG_BITMAP_DATA, "Bitmap Data"],
  [WPG_TEXT_DATA, "Text Data"],
  [WPG_CHART_STYLE, "Chart Style"],
  [WPG_CHART_DATA, "Chart Data"],
  [WPG_OBJECT_IMAGE, "Object Image"],
  [WPG_POLYLINE, "Polyline"],
  [WPG_POLYSPLINE, "Polyspline"],
  [WPG_POLYCURVE, "Polycurve"],
  [WPG_RECTANGLE, "Rectangle"],
  [WPG_ARC, "Arc"],
  [WPG_COMPOUND_POLYGON, "Compound Polygon"],
  [WPG_BITMAP, "Bitmap"],
  [WPG_TEXT_LINE, "Text Line"],
  [WPG_TEXT_BLOCK, "Text Block"],
  [WPG_TEXT_PATH, "Text Path"],
  [WPG_CHART, "Chart"],
  [WPG_OBJECT_CAPSULE, "Object Capsule"],
  [WPG_FONT_SETTINGS, "Font Settings"],
  [WPG_PEN_BACK_COLOR, "Pen Back Color"],
  [WPG_DP_PEN_BACK_COLOR, "DP Pen Back Color"],
  [WPG_PEN_STYLE, "Pen Style"],
  [WPG_PEN_PATTERN, "Pen Pattern"],
  [WPG_LINE_CAP, "Line Cap"],
  [WPG_LINE_JOIN, "Line Join"],
  [WPG_BRUSH_GRADIENT, "Brush Gradient"],
  [WPG_DP_BRUSH_GRADIENT, "DP Brush Gradient"],
  [WPG_BRUSH_BACK_COLOR, "Brush Back Color"],
  [WPG_DP_BRUSH_BACK_COLOR, "DP Brush Back Color"],
  [WPG_BRUSH_PATTERN, "Brush Pattern"],
  [WPG_HORIZONTAL_LINE, "Horizontal Line"],
  [WPG_VERTICAL_LINE, "Vertical Line"],
  [WPG_POSTER_SETTINGS, "Poster Settings"],
  [WPG_IMAGE_STATE, "Image State"],
  [WPG_ENVELOPE_DEFINITION, "Envelope Definition"],
  [WPG_ENVELOPE, "Envelope"],
  [WPG_TEXTURE_DEFINITION, "Texture Definition"],
  [WPG_BRUSH_TEXTURE, "Brush Texture"],
  [WPG_TEXTURE_ALIGNMENT, "Texture Alignment"],
  [WPG_PEN_TEXTURE, "Pen Texture"],
]);

// Characterisation flag bits, per the SDK's own table: bits 0-4 state that optional transformation data follows (taper, translate, skew, scale, rotate — every one a transformation this decoder refuses a record for), bit 5 an Object ID, bit 7 an edit-lock descriptor, and the high byte's two-state options — bit 12 the winding path rule, bit 13 fill, bit 14 close, bit 15 frame.
const FLAG_TAPER = 1 << 0;
const FLAG_TRANSLATE = 1 << 1;
const FLAG_SKEW = 1 << 2;
const FLAG_SCALE = 0x0008;
const FLAG_ROTATE = 0x0010;
const FLAG_OBJECT_ID = 0x0020;
const FLAG_EDIT_LOCK = 0x0080;
export const FLAG_PATH_WINDING = 0x1000;
export const FLAG_FILL = 0x2000;
export const FLAG_CLOSE = 0x4000;
export const FLAG_FRAME = 0x8000;

// The one approximation this decoder makes: a rounded Rectangle's corners are quarter ellipses, and the shared path model carries only straight and cubic segments, so each quarter becomes the standard cubic approximation of a quarter ellipse — control points offset by 4/3*(sqrt(2)-1) of the radii, the identical bounded approximation this family's SVG path module applies to elliptical arcs at no more than 90 degrees per cubic. Derived from the circle constant here rather than hard-coded, so the geometry and its derivation stay checkable together.
const QUARTER_ELLIPSE_KAPPA_NUMERATOR = 4;
const QUARTER_ELLIPSE_KAPPA_DENOMINATOR = 3;
export const QUARTER_ELLIPSE_KAPPA =
  (QUARTER_ELLIPSE_KAPPA_NUMERATOR / QUARTER_ELLIPSE_KAPPA_DENOMINATOR) *
  (Math.SQRT2 - 1);

// The WPG prefix's own product/file-type/version gates: product type 1 ("always 1 for WPG files"), file type 22 (0x16, "always 22 for WPG files"), and the major version byte that separates the two record vocabularies (2 for the framed record stream this decoder reads, 1 for WPG 1.0's earlier type-and-length-only stream it refuses).
const WPG_PRODUCT_TYPE = 1;
const WPG_FILE_TYPE = 0x16;
const WPG_MAJOR_2 = 2;
const WPG_MAJOR_1 = 1;

// The fixed prefix head: file ID (4), {start of document} (4), product type, file type, major version, minor version, [encryption key] (2), [start packet data] (2), entry count, resource complete, [start encryption] (2), {file size} (4), [encryption version] (2). Every field this decoder reads sits inside it.
const WPG_PREFIX_HEAD_SIZE = 26;

export const POINTS_PER_INCH = 72;

// The one injected dependency: a Text Data record's bytes are a WP document stream, and folding one into blocks is the read layer's own machinery (the identical tokeniser and fold a box's WP-text content takes) — injected as a callback so this module stays a pure byte decoder with no dependency back on src/read.ts.
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

// The running rendition state a drawing's records decode against, seeded from the specification's own "WPG Defaults" table: pen and brush foreground black, pen width 0 ("0 = hairline", the thinnest width the output device can render), opacities fully opaque. The hairline default has no positive point value the shared stroke shape can state (its widthPt is positive-only), so a framed record with no Pen Size record states no stroke at all — the identical reading the family's PDF reconstruction gives a zero-width paint, whose stroke is likewise absent rather than a guessed width.
export interface WpgRenditionState {
  penColor: WpgColor;
  penWidthUnits: number;
  brushColor: WpgColor;
}

const WPG_DEFAULT_BLACK: WpgColor = { r: 0, g: 0, b: 0, a: 0 };

// The running geometry every decoded coordinate converts through: the image extent in points (the page size and the Y-flip reference), the pixels-per-inch of each axis, and the coordinate precision Start WPG stated.
export interface WpgGeometry {
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
  if (first <= WPG_INTEGER_DIRECT_MAX) {
    return { value: first, next: cursor + 1 };
  }
  if (cursor + WPG_SHORT_INTEGER_SIZE > bytes.length) {
    return undefined;
  }
  const shortValue = uint16At(bytes, cursor + 1);
  if ((shortValue & WPG_LONG_ESCAPE_MASK) === 0) {
    return { value: shortValue, next: cursor + WPG_SHORT_INTEGER_SIZE };
  }
  if (cursor + WPG_LONG_INTEGER_SIZE > bytes.length) {
    return undefined;
  }
  const lowHalf = uint16At(bytes, cursor + WPG_SHORT_INTEGER_SIZE);
  return {
    value: ((shortValue & WPG_LONG_VALUE_MASK) << USHORT_BITS) + lowHalf,
    next: cursor + WPG_LONG_INTEGER_SIZE,
  };
}

// Reads one coordinate at the stream's stated precision: a signed 16-bit unit in single precision, a 32-bit 16.16 fixed-point value in double ("Corel products use the fractional portion for rounding only", so the fraction is kept rather than truncated).
export function coordinateAt(
  bytes: Uint8Array,
  offset: number,
  doublePrecision: boolean,
): number {
  if (!doublePrecision) {
    return int16At(bytes, offset);
  }
  return uint32At(bytes, offset) / FIXED_POINT_ONE;
}

// The characterisation flags word plus the walk past the optional data its low bits state — exactly as far as this decoder needs: past the edit-lock descriptor and the Object ID. A record carrying any transformation flag (taper/translate/skew/scale/rotate) is refused whole, so the transformation elements themselves are never walked past — like every other refusal this function makes, that is undefined, not a sentinel value inside an otherwise-valid result for callers to separately test.
export function readCharacterization(
  bytes: Uint8Array,
  cursor: number,
): { readonly flags: number; readonly geometryAt: number } | undefined {
  // No recordEnd parameter: both of this function's own callers always passed exactly bytes.length for it (their own record's whole data), which uint16At already enforces on its own — it throws (via byteAt) rather than returning undefined for a read past bytes' own end, caught once below, so neither the flags word nor the Object ID's own short/long check needs a separate room guard ahead of it. This also drops the final geometryAt > bytes.length check that used to close this function: every one of readCharacterization's own callers (readTextBlockFrame's explicit check, readWpgRectangle's and readWpgFullEllipse's own, readPolyline's throwing reads) already refuses identically the moment it tries to read geometry starting past its own record's end, so a geometryAt this function itself deemed "too far" and one that merely turned out that way downstream are never distinguishable to any of them.
  try {
    const flags = uint16At(bytes, cursor);
    const transformationFlags =
      FLAG_TAPER | FLAG_TRANSLATE | FLAG_SKEW | FLAG_SCALE | FLAG_ROTATE;
    if ((flags & transformationFlags) !== 0) {
      return undefined;
    }
    let geometryAt = cursor + 2;
    if ((flags & FLAG_EDIT_LOCK) !== 0) {
      geometryAt += EDIT_LOCK_FIELD_SIZE;
    }
    if ((flags & FLAG_OBJECT_ID) !== 0) {
      // An Object ID is a short, or a long when the short's high bit is set.
      geometryAt +=
        (uint16At(bytes, geometryAt) & WPG_LONG_ESCAPE_MASK) !== 0
          ? ULONG_FIELD_SIZE
          : USHORT_FIELD_SIZE;
    }
    return { flags, geometryAt };
  } catch {
    return undefined;
  }
}

export function xToPt(geometry: WpgGeometry, x: number): number {
  return (x / geometry.xPpi) * POINTS_PER_INCH;
}

// WPG's Y grows up from the extent's bottom; the shared model's grows down from the page top. Flipping against the extent height converts one to the other.
export function yToPt(geometry: WpgGeometry, y: number): number {
  return geometry.heightPt - (y / geometry.yPpi) * POINTS_PER_INCH;
}

export function strokeOf(
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

export function fillOf(state: WpgRenditionState): {
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
  if (data.length < RGBA_COMPONENT_COUNT) {
    return undefined;
  }
  return {
    r: byteAt(data, 0) / UINT8_MAX,
    g: byteAt(data, 1) / UINT8_MAX,
    b: byteAt(data, 2) / UINT8_MAX,
    a: byteAt(data, RGBA_ALPHA_OFFSET) / UINT8_MAX,
  };
}

// A double-precision colour record: the same four components as shorts on the same 0..1 scale, 65535 standing for 100%.
function readDoubleColor(data: Uint8Array): WpgColor | undefined {
  if (data.length < RGBA16_BYTE_LENGTH) {
    return undefined;
  }
  return {
    r: uint16At(data, 0) / UINT16_MAX,
    g: uint16At(data, USHORT_BYTES) / UINT16_MAX,
    b: uint16At(data, 2 * USHORT_BYTES) / UINT16_MAX,
    a: uint16At(data, RGBA_ALPHA_16_OFFSET) / UINT16_MAX,
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
      byteAt(bytes, index) !== WPG_FILE_ID[0] ||
      byteAt(bytes, index + 1) !== WPG_FILE_ID[1] ||
      byteAt(bytes, index + 2) !== WPG_FILE_ID[2] ||
      byteAt(bytes, index + WPG_FILE_ID_LAST) !== WPG_FILE_ID[WPG_FILE_ID_LAST]
    ) {
      continue;
    }
    if (
      byteAt(bytes, index + PREFIX_PRODUCT_TYPE_OFFSET) !== WPG_PRODUCT_TYPE ||
      byteAt(bytes, index + PREFIX_FILE_TYPE_OFFSET) !== WPG_FILE_TYPE
    ) {
      continue;
    }
    start = index;
    break;
  }
  if (start < 0) {
    return undefined;
  }
  const majorVersion = byteAt(bytes, start + PREFIX_MAJOR_VERSION_OFFSET);
  if (majorVersion === WPG_MAJOR_1) {
    return { status: "refused", reason: "wpg1" };
  }
  if (majorVersion !== WPG_MAJOR_2) {
    return { status: "refused", reason: "malformed" };
  }
  if (uint16At(bytes, start + PREFIX_ENCRYPTION_FLAG_OFFSET) !== 0) {
    return { status: "refused", reason: "encrypted" };
  }
  // Neither half of the original "recordStart < start + WPG_PREFIX_HEAD_SIZE || recordStart >= bytes.length" guard is needed as a check of its own. A recordStart at or past bytes.length makes cursor (start + recordStart, below) at least bytes.length too, and the record walk's own leading read breaks on its very first iteration for any such cursor. A recordStart landing inside the fixed 26-byte header instead points the walk at bytes this format never lays out as a record: the header's own critical fields (product type, file type, major version) are already validated at their own fixed offsets regardless of recordStart, and the remaining header bytes are too few (well short of the 25 a minimal Start WPG record needs) to ever assemble into one — verified directly, not just argued, by removing this guard outright and confirming every test in this file (including the leading-garbage and corrupted-recordStart fixtures written specifically to probe it) still passes. Either way, geometry never gets set, and this function's own later `if (geometry === undefined)` check refuses with the identical {malformed} result no matter how recordStart itself went wrong.
  const recordStart = uint32At(bytes, start + PREFIX_RECORD_START_OFFSET);

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
    RECORD_NAMES.get(type) ?? `record type 0x${type.toString(HEX_RADIX)}`;

  // The loop's own termination: byteAt throws (via its own bounds check) the moment there is no room left even for the Class/Type pair, caught here to end the walk with whatever was already decoded, rather than a separate "cursor + 2 > bytes.length" pre-check whose own threshold exactly matches byteAt's own — the two could never disagree on any input.
  for (;;) {
    let type: number;
    try {
      type = byteAt(bytes, cursor + 1);
    } catch {
      break;
    }
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

    // The group bookkeeping: this record consumes one member slot of the innermost open group, a group whose last member just arrived closes before this record can open one of its own, and a record with members opens a new context — a Group's members independent objects walked as their own records, a decoded Text Block's Text Data member walked as its payload, every other grouped record's members swallowed with their opener.
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
          if (data.length < START_WPG_MIN_SIZE) {
            skipped.add(recordName(type));
            break;
          }
          const xPpi = uint16At(data, 0);
          const yPpi = uint16At(data, 2);
          const precision = byteAt(data, START_WPG_PRECISION_OFFSET);
          if (
            xPpi === 0 ||
            yPpi === 0 ||
            (precision !== 0 && precision !== 1)
          ) {
            return { status: "refused", reason: "malformed" };
          }
          const doublePrecision = precision === 1;
          const coordinateSize = doublePrecision
            ? ULONG_FIELD_SIZE
            : USHORT_FIELD_SIZE;
          const extentAt =
            START_WPG_EXTENT_OFFSET +
            coordinateSize * VIEWPORT_COORDINATE_COUNT;
          if (
            extentAt + coordinateSize * VIEWPORT_COORDINATE_COUNT >
            data.length
          ) {
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
            extentAt + coordinateSize * EXTENT_FIRST_COORDINATE,
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
          if (data.length >= RGBA_COMPONENT_COUNT) {
            state.penWidthUnits = uint16At(data, 0);
          }
          break;
        }
        case RECORD_DP_PEN_SIZE: {
          if (data.length >= RGBA16_BYTE_LENGTH) {
            state.penWidthUnits = uint32At(data, 0) / FIXED_POINT_ONE;
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
            // A Text Data with no Text Block before it is a Text Line's or Text Path's payload — both records this reader skips — so it is named with them rather than decoded against a frame nothing stated.
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

    // groups[groups.length - 1] on an empty array is groups[-1], which is undefined — the optional chain already answers false without a separate "groups.length > 0" guard.
    while (groups[groups.length - 1]?.remaining === 0) {
      groups.pop();
    }
    if (extension.value > 0) {
      // A Group's members are independent objects, and a decoded Text Block's Text Data member is the payload the switch folds — both walk. Every other grouped record's members belong to their opener, so if the opener was skipped (or was itself swallowed) they are swallowed with it. No separate `type === RECORD_TEXT_BLOCK` guard is needed on the second half: pendingTextBlockFrame is already cleared to undefined, just above, for every type other than RECORD_TEXT_BLOCK, so `pendingTextBlockFrame !== undefined` is already false for all of them regardless of type — the guard would only ever restate what clearing it already guarantees.
      groups.push({
        remaining: extension.value,
        membersWalk:
          !swallowed &&
          (type === RECORD_GROUP || pendingTextBlockFrame !== undefined),
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

// Whether the record about to be handled sits inside a group whose members are swallowed rather than walked: its DIRECT parent decides — the innermost context open at the moment the record arrives, exactly as the nesting rule states (a grouped logical record counts as one member of the group outside it). The one shape this rule cannot express is a Group nested inside a swallowed group, whose members would walk as top-level records; the specification's own extension lists name no such shape (a Compound Polygon's or Chart's members are path, rendition, and data records, never Groups).
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
  const characterization = readCharacterization(data, 0);
  if (
    characterization === undefined ||
    characterization.geometryAt +
      geometry.coordinateSize * VIEWPORT_COORDINATE_COUNT >
      data.length
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
      at + geometry.coordinateSize * EXTENT_FIRST_COORDINATE,
      geometry.doublePrecision,
    ),
  );
}

// The shared frame for two WPG corners (lower-left and upper-right, Y up): normalised and converted to the model's top-left-origin, Y-down page space, in points. yToPt has already performed the one flip against the extent height, so the smaller converted Y is the frame's top edge — subtracting it from heightPt again would flip it back into Y-up space.
export function frameFromCorners(
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
