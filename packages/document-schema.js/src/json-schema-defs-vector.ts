// Hand-transcribed JSON Schema fragments for the $defs map, split from content-json-schema-defs.ts (see that module for the transcription discipline and the live-comparison regression suite). Merged into CONTENT_DEFS by property descriptor so this part occupies its exact place in the key order.
import {
  type JsonSchema,
  MAX_SAFE_INTEGER,
  EMBEDDED_OBJECT_KINDS,
  CONTENT_DOCUMENT_URI,
} from "./json-schema-defs-shared";

export const DEFS_VECTOR: Record<string, JsonSchema> = {
  ContentStrokeDash: {
    type: "object",
    properties: {
      dots1: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      dots1LengthPt: { type: "number", exclusiveMinimum: 0 },
      dots2: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      dots2LengthPt: { type: "number", exclusiveMinimum: 0 },
      distancePt: { type: "number", minimum: 0 },
    },
    required: ["dots1", "dots1LengthPt", "distancePt"],
    additionalProperties: false,
  },
  ContentStroke: {
    type: "object",
    properties: {
      color: { $ref: "#/$defs/Color" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      style: { $ref: "#/$defs/ContentStrokeStyle" },
      opacity: { type: "number", minimum: 0, maximum: 1 },
      dashPattern: { $ref: "#/$defs/ContentStrokeDash" },
    },
    required: ["color", "widthPt"],
    additionalProperties: false,
  },
  ContentGradientStyle: {
    type: "string",
    enum: ["linear", "axial", "radial", "ellipsoid", "square", "rectangular"],
  },
  ContentGradientFill: {
    type: "object",
    properties: {
      kind: { type: "string", const: "gradient" },
      style: { $ref: "#/$defs/ContentGradientStyle" },
      startColor: { $ref: "#/$defs/Color" },
      endColor: { $ref: "#/$defs/Color" },
      angleDeg: { type: "number" },
    },
    required: ["kind", "style", "startColor", "endColor"],
    additionalProperties: false,
  },
  ContentHatchStyle: {
    type: "string",
    enum: ["single", "double", "triple"],
  },
  ContentHatchFill: {
    type: "object",
    properties: {
      kind: { type: "string", const: "hatch" },
      style: { $ref: "#/$defs/ContentHatchStyle" },
      color: { $ref: "#/$defs/Color" },
      distancePt: { type: "number", minimum: 0 },
      rotationDeg: { type: "number" },
    },
    required: ["kind", "style", "color", "distancePt"],
    additionalProperties: false,
  },
  ContentBitmapFill: {
    type: "object",
    properties: {
      kind: { type: "string", const: "bitmap" },
      format: { type: "string", enum: ["png", "jpeg", "svg", "gif"] },
      base64: { type: "string" },
    },
    required: ["kind", "format", "base64"],
    additionalProperties: false,
  },
  ContentFillPattern: {
    oneOf: [
      { $ref: "#/$defs/ContentGradientFill" },
      { $ref: "#/$defs/ContentHatchFill" },
      { $ref: "#/$defs/ContentBitmapFill" },
    ],
  },
  ContentPathPoint: {
    type: "object",
    properties: {
      xPt: { type: "number" },
      yPt: { type: "number" },
    },
    required: ["xPt", "yPt"],
    additionalProperties: false,
  },
  ContentPathSegment: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "line" },
          to: { $ref: "#/$defs/ContentPathPoint" },
        },
        required: ["kind", "to"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "cubic" },
          control1: { $ref: "#/$defs/ContentPathPoint" },
          control2: { $ref: "#/$defs/ContentPathPoint" },
          to: { $ref: "#/$defs/ContentPathPoint" },
        },
        required: ["kind", "control1", "control2", "to"],
        additionalProperties: false,
      },
    ],
  },
  ContentSubpath: {
    type: "object",
    properties: {
      start: { $ref: "#/$defs/ContentPathPoint" },
      segments: {
        type: "array",
        items: { $ref: "#/$defs/ContentPathSegment" },
      },
      closed: { type: "boolean" },
    },
    required: ["start", "segments", "closed"],
    additionalProperties: false,
  },
  // The textless vector primitives, in their declared variant order (rect / ellipse / line / path, src/content.ts's ContentVectorSchema).
  ContentVector: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "rect" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          fill: { $ref: "#/$defs/Color" },
          fillPattern: { $ref: "#/$defs/ContentFillPattern" },
          fillOpacity: { type: "number", minimum: 0, maximum: 1 },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
          origin: { $ref: "#/$defs/ContentOrigin" },
          interpretation: { $ref: "#/$defs/ContentInterpretation" },
        },
        required: ["kind", "frame"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "ellipse" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          fill: { $ref: "#/$defs/Color" },
          fillPattern: { $ref: "#/$defs/ContentFillPattern" },
          fillOpacity: { type: "number", minimum: 0, maximum: 1 },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
          origin: { $ref: "#/$defs/ContentOrigin" },
          interpretation: { $ref: "#/$defs/ContentInterpretation" },
        },
        required: ["kind", "frame"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "line" },
          from: { $ref: "#/$defs/ContentPathPoint" },
          to: { $ref: "#/$defs/ContentPathPoint" },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
          origin: { $ref: "#/$defs/ContentOrigin" },
          interpretation: { $ref: "#/$defs/ContentInterpretation" },
        },
        required: ["kind", "from", "to", "stroke"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "path" },
          frame: { $ref: "#/$defs/Box" },
          rotationDeg: { type: "number" },
          subpaths: {
            type: "array",
            items: { $ref: "#/$defs/ContentSubpath" },
          },
          fill: { $ref: "#/$defs/Color" },
          fillPattern: { $ref: "#/$defs/ContentFillPattern" },
          fillOpacity: { type: "number", minimum: 0, maximum: 1 },
          fillRule: { type: "string", enum: ["nonzero", "evenodd"] },
          stroke: { $ref: "#/$defs/ContentStroke" },
          paintOrder: { type: "number" },
          sourcePath: { type: "string" },
          source: { $ref: "#/$defs/SourceResidue" },
          frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
          origin: { $ref: "#/$defs/ContentOrigin" },
          interpretation: { $ref: "#/$defs/ContentInterpretation" },
        },
        required: ["kind", "frame", "subpaths"],
        additionalProperties: false,
      },
    ],
  },
  // An embedded object on its own (the sheet-children leaf position) — the same member fields as ContentEmbeddedObjectBlock above minus the block-level kind discriminant, transcribed from the ContentEmbeddedObject interface (src/content.ts), which has no z.object() counterpart at all.
  ContentEmbeddedObject: {
    type: "object",
    properties: {
      objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: "#/$defs/Box" },
      anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: "number" },
      offsetYPt: { type: "number" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["objectKind", "document", "frame"],
    additionalProperties: false,
  },
  // The nine group wrappers, hand-verified alone (recursive through their children arrays): `{ node, style?, children }` where children's permitted members are exactly that group kind's own child types (src/package-node.ts's per-kind guards) — which is why every block-flow wrapper points at TreeBlockLeaf rather than ContentBlock: a construct is a group at these positions, never a boundary marker. A wordprocessing section's flow.
  SectionGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/SectionDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  HeadingGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/HeadingParagraph" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ListGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ListParagraph" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // A slide holds shape groups only, in shape order — grouping never crosses a shape boundary (a slide's paragraphs across its shapes is the outline's lossy TOC projection, not a decomposition).
  SlideGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/SlideDescriptor" },
      style: { type: "string" },
      children: { type: "array", items: { $ref: "#/$defs/ShapeGroup" } },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ShapeGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ShapeDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // A sheet's children: its anchored images then its whole embedded documents, in that fixed order; the grid rides the sheet descriptor.
  SheetGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/SheetDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ContentSheetImage" },
            { $ref: "#/$defs/ContentEmbeddedObject" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // A drawing page's children: shape groups then vector leaves, in that fixed order.
  DrawPageGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/DrawPageDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ShapeGroup" },
            { $ref: "#/$defs/ContentVector" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // The two construct group wrappers (src/package-node.ts), hand-verified alone for the same reason as the seven above — their children arrays recurse back through the same per-flow child unions. One per block flow: the section-scoped variant admits heading groups, the shape-scoped one does not, exactly as SectionChild and ShapeChild differ. A list item's flow takes the shape-scoped variant, since ListChild and ShapeChild admit the same members.
  SectionConstructGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ConstructDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/HeadingGroup" },
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/SectionConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  ShapeConstructGroup: {
    type: "object",
    properties: {
      node: { $ref: "#/$defs/ConstructDescriptor" },
      style: { type: "string" },
      children: {
        type: "array",
        items: {
          oneOf: [
            { $ref: "#/$defs/ListGroup" },
            { $ref: "#/$defs/ShapeConstructGroup" },
            { $ref: "#/$defs/TreeBlockLeaf" },
          ],
        },
      },
    },
    required: ["node", "children"],
    additionalProperties: false,
  },
  // — The construct descriptor vocabulary (src/construct.ts), the node payload of the two group wrappers above. Every fragment from here to ConstructDescriptor has a real, non-recursive, non-custom Zod counterpart, so all of them are held to the live z.toJSONSchema() comparison by content-json-schema-defs.test.ts rather than needing hand re-verification. --
};
