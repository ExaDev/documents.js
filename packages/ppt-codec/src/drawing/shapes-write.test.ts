import type { ContentShape } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { NOOP_PPT_DIAGNOSTIC_SINK } from "../diagnostics";
import { childRecords, findChild, readRecordAt } from "../record/tree";
import {
  OfficeArtDgContainer,
  OfficeArtFSPGR,
  OfficeArtSpContainer,
  OfficeArtSpgrContainer,
} from "../record/types";
import {
  PROPERTY_DX_TEXT_LEFT,
  PROPERTY_DX_TEXT_RIGHT,
  PROPERTY_DY_TEXT_BOTTOM,
  PROPERTY_DY_TEXT_TOP,
  PROPERTY_PIB,
  PROPERTY_ROTATION,
  readShapeProperties,
} from "./properties";
import {
  type DrawingShape,
  type DrawingWriteContext,
  writeSlideDrawing,
} from "./shapes-write";

const CONTEXT: DrawingWriteContext = {
  fontIndexOf: () => 0,
  blipIndexOf: () => 1,
  sink: NOOP_PPT_DIAGNOSTIC_SINK,
  strict: false,
  location: "test",
};

const DEFAULT_TEXT_INSETS = {
  insetLeftPt: 0.1 * 72,
  insetTopPt: 0.05 * 72,
  insetRightPt: 0.1 * 72,
  insetBottomPt: 0.05 * 72,
};

function textShape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    ...DEFAULT_TEXT_INSETS,
    blocks: [],
    ...overrides,
  };
}

// RT_Drawing -> OfficeArtDgContainer -> OfficeArtSpgrContainer -> [patriarch, ...content shapes].
function spgrChildren(written: ReturnType<typeof writeSlideDrawing>) {
  const record = readRecordAt(written.bytes, 0);
  const dgContainer = findChild(childRecords(record), OfficeArtDgContainer);
  if (dgContainer === undefined) {
    throw new Error("expected an OfficeArtDgContainer");
  }
  const spgrContainer = findChild(
    childRecords(dgContainer),
    OfficeArtSpgrContainer,
  );
  if (spgrContainer === undefined) {
    throw new Error("expected an OfficeArtSpgrContainer");
  }
  return childRecords(spgrContainer);
}

function firstShapeProperties(written: ReturnType<typeof writeSlideDrawing>) {
  const [, shapeRecord] = spgrChildren(written).filter(
    (r) => r.header.recType === OfficeArtSpContainer,
  );
  if (shapeRecord === undefined) {
    throw new Error("expected the patriarch plus one content shape");
  }
  return readShapeProperties(shapeRecord);
}

describe("writeSlideDrawing: insets", () => {
  it("writes no inset property at all when every inset matches the plain-text default", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_TOP)).toBeUndefined();
    expect(properties.get(PROPERTY_DX_TEXT_RIGHT)).toBeUndefined();
    expect(properties.get(PROPERTY_DY_TEXT_BOTTOM)).toBeUndefined();
  });

  it.each([
    ["insetLeftPt", PROPERTY_DX_TEXT_LEFT],
    ["insetTopPt", PROPERTY_DY_TEXT_TOP],
    ["insetRightPt", PROPERTY_DX_TEXT_RIGHT],
    ["insetBottomPt", PROPERTY_DY_TEXT_BOTTOM],
  ] as const)(
    "writes only %s when it alone differs from the default",
    (field, opid) => {
      const shapes: DrawingShape[] = [
        { shape: textShape({ [field]: 20 }), clientData: undefined },
      ];
      const properties = firstShapeProperties(
        writeSlideDrawing(shapes, CONTEXT),
      );
      const others = [
        PROPERTY_DX_TEXT_LEFT,
        PROPERTY_DY_TEXT_TOP,
        PROPERTY_DX_TEXT_RIGHT,
        PROPERTY_DY_TEXT_BOTTOM,
      ].filter((o) => o !== opid);
      expect(properties.get(opid)).toBeDefined();
      for (const other of others) {
        expect(properties.get(other)).toBeUndefined();
      }
    },
  );

  it("uses zero, not the text default, as a picture shape's own inset default", () => {
    const shapes: DrawingShape[] = [
      {
        shape: textShape({
          insetLeftPt: 0,
          insetTopPt: 0,
          insetRightPt: 0,
          insetBottomPt: 0,
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: "AA==",
            },
          ],
        }),
        clientData: undefined,
      },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_DX_TEXT_LEFT)).toBeUndefined();
    expect(properties.get(PROPERTY_PIB)?.value).toBe(1);
  });
});

describe("writeSlideDrawing: rotation and pib", () => {
  it("writes rotation as a fixed-point degrees value", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape({ rotationDeg: 90 }), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.get(PROPERTY_ROTATION)?.value).toBe(90 * 0x10000);
  });

  it("writes no property table at all for a shape stating nothing beyond the plain-text defaults", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const properties = firstShapeProperties(writeSlideDrawing(shapes, CONTEXT));
    expect(properties.size).toBe(0);
  });
});

describe("writeSlideDrawing: patriarch framing", () => {
  it("stamps recVer 0x1 on the patriarch's own degenerate OfficeArtFSPGR", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    const [patriarch] = spgrChildren(written);
    if (patriarch === undefined) {
      throw new Error("expected the patriarch shape container first");
    }
    const fspgr = findChild(childRecords(patriarch), OfficeArtFSPGR);
    expect(fspgr?.header.recVer).toBe(0x1);
  });

  it("counts the patriarch plus every content shape in shapeCount", () => {
    const shapes: DrawingShape[] = [
      { shape: textShape(), clientData: undefined },
      { shape: textShape(), clientData: undefined },
    ];
    const written = writeSlideDrawing(shapes, CONTEXT);
    expect(written.shapeCount).toBe(3);
  });
});
