// Hand-transcribed JSON Schema fragments for the $defs map, split from content-json-schema-defs.ts (see that module for the transcription discipline and the live-comparison regression suite). Merged into CONTENT_DEFS by property descriptor so this part occupies its exact place in the key order.
import {
  type JsonSchema,
  MAX_SAFE_INTEGER,
  EMBEDDED_OBJECT_KINDS,
  CONTENT_DOCUMENT_URI,
} from "./json-schema-defs-shared";

export const DEFS_BLOCKS: Record<string, JsonSchema> = {
  Color: {
    type: "object",
    properties: {
      r: { type: "number", minimum: 0, maximum: 1 },
      g: { type: "number", minimum: 0, maximum: 1 },
      b: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["r", "g", "b"],
    additionalProperties: false,
  },
  Box: {
    type: "object",
    properties: {
      xPt: { type: "number" },
      yPt: { type: "number" },
      widthPt: { type: "number", minimum: 0 },
      heightPt: { type: "number", minimum: 0 },
    },
    required: ["xPt", "yPt", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  LayoutFrame: {
    type: "object",
    properties: {
      pageIndex: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      xPt: { type: "number" },
      yPt: { type: "number" },
      widthPt: { type: "number", minimum: 0 },
      heightPt: { type: "number", minimum: 0 },
    },
    required: ["pageIndex", "xPt", "yPt", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  Alignment: {
    type: "string",
    enum: ["left", "center", "right", "justify"],
  },
  // The quarantined residue channel (src/source.ts): one `source: { format, xml }` value riding every content node and construct descriptor, including division since ExaDev/documents.js#743 renamed its external-chapter link field to `linked`, and the package root's per-key table. A real, non-recursive Zod schema, so this fragment is held to the live z.toJSONSchema() comparison by content-json-schema-defs.test.ts like the descriptors beside it.
  SourceResidue: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: [
          "docx",
          "pptx",
          "xlsx",
          "odt",
          "ods",
          "odp",
          "odg",
          "odm",
          "odb",
          "odf",
          "markdown",
          "pdf",
          "epub",
          "rtf",
          "wpd",
        ],
      },
      xml: { type: "string" }, // opaque text — validation stops at "is a string"; everything about the content is the producer's to know
    },
    required: ["format", "xml"],
    additionalProperties: false,
  },
  ContentStrokeStyle: {
    type: "string",
    enum: ["solid", "dashed", "dotted", "double"],
  },
  ContentBorder: {
    type: "object",
    properties: {
      color: { $ref: "#/$defs/Color" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      style: { $ref: "#/$defs/ContentStrokeStyle" }, // absent means 'solid'
    },
    required: ["color", "widthPt"],
    additionalProperties: false,
  },
  ContentCellBorders: {
    type: "object",
    properties: {
      left: { $ref: "#/$defs/ContentBorder" },
      right: { $ref: "#/$defs/ContentBorder" },
      top: { $ref: "#/$defs/ContentBorder" },
      bottom: { $ref: "#/$defs/ContentBorder" },
      diagonalUp: { $ref: "#/$defs/ContentBorder" }, // bottom-left to top-right
      diagonalDown: { $ref: "#/$defs/ContentBorder" }, // top-left to bottom-right
    },
    additionalProperties: false,
  },
  ContentParagraphBorders: {
    type: "object",
    properties: {
      left: { $ref: "#/$defs/ContentBorder" },
      right: { $ref: "#/$defs/ContentBorder" },
      top: { $ref: "#/$defs/ContentBorder" },
      bottom: { $ref: "#/$defs/ContentBorder" },
    },
    additionalProperties: false,
  },
  // The closed pattern-type vocabulary a table/sheet cell's own pattern fill can name — WordprocessingML's ST_Shd percentage/stripe/cross families and SpreadsheetML's ST_PatternType named-density/hatch families, spliced into one flat enum since the two never share a member name (src/content.ts's own ContentCellPatternTypeSchema comment has the full citation).
  ContentCellPatternType: {
    type: "string",
    enum: [
      "percent5",
      "percent10",
      "percent12",
      "percent15",
      "percent20",
      "percent25",
      "percent30",
      "percent35",
      "percent37",
      "percent40",
      "percent45",
      "percent50",
      "percent55",
      "percent60",
      "percent62",
      "percent65",
      "percent70",
      "percent75",
      "percent80",
      "percent85",
      "percent87",
      "percent90",
      "percent95",
      "horizontalStripe",
      "verticalStripe",
      "diagonalStripe",
      "reverseDiagonalStripe",
      "horizontalCross",
      "diagonalCross",
      "thinHorizontalStripe",
      "thinVerticalStripe",
      "thinDiagonalStripe",
      "thinReverseDiagonalStripe",
      "thinHorizontalCross",
      "thinDiagonalCross",
      "mediumGray",
      "darkGray",
      "lightGray",
      "darkHorizontal",
      "darkVertical",
      "darkDown",
      "darkUp",
      "darkGrid",
      "darkTrellis",
      "lightHorizontal",
      "lightVertical",
      "lightDown",
      "lightUp",
      "lightGrid",
      "lightTrellis",
      "gray125",
      "gray0625",
    ],
  },
  // A table/sheet cell's own background (src/content.ts's ContentCellFillSchema): a plain discriminated union of two strict objects reaching no opaque node, so this fragment is held to the live z.toJSONSchema() comparison by content-json-schema-defs.test.ts like the descriptors beside it.
  ContentCellFill: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "solid" },
          color: { $ref: "#/$defs/Color" },
        },
        required: ["kind", "color"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "pattern" },
          patternType: { $ref: "#/$defs/ContentCellPatternType" },
          foregroundColor: { $ref: "#/$defs/Color" },
          backgroundColor: { $ref: "#/$defs/Color" },
        },
        required: ["kind", "patternType"],
        additionalProperties: false,
      },
    ],
  },
  ContentListMembership: {
    type: "object",
    properties: {
      numId: { type: "string" }, // optional in the Zod source — depth-only list membership (OOXML drawing paragraphs) carries no numbering identity
      level: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      checked: { type: "boolean" }, // a GFM task-list item's checkbox state — see src/content.ts's own field comment
      itemId: { type: "string" }, // the identity of ONE list item, distinguishing "one item, several blocks" from sibling items sharing a numId/level — see src/content.ts's own field comment
      format: {
        type: "string",
        enum: [
          "bullet",
          "decimal",
          "lowerLetter",
          "upperLetter",
          "lowerRoman",
          "upperRoman",
        ],
      }, // the item's own numbering format — see src/content.ts's own field comment
    },
    required: ["level"],
    additionalProperties: false,
  },
  ContentRun: {
    type: "object",
    properties: {
      text: { type: "string" },
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      strike: { type: "boolean" },
      fontFamily: { type: "string" },
      sizePt: { type: "number", exclusiveMinimum: 0 },
      color: { $ref: "#/$defs/Color" },
      hyperlink: { type: "string" }, // resolved external URI
      verticalAlign: { type: "string", enum: ["superscript", "subscript"] },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlch/\ltrch scope — see src/content.ts's own field comment
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  // A run-scoped construct extent (src/content.ts's RunConstructExtentSchema): one construct covering a sub-sequence of one paragraph's runs, as a descriptor plus a half-open run range. A plain z.object reaching only the strict-object descriptor vocabulary, so it is held to the live comparison by content-json-schema-defs.test.ts.
  RunConstructExtent: {
    type: "object",
    properties: {
      descriptor: { $ref: "#/$defs/ConstructDescriptor" },
      startRun: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      endRun: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
    },
    required: ["descriptor", "startRun", "endRun"],
    additionalProperties: false,
  },
  ContentParagraph: {
    type: "object",
    properties: {
      kind: { type: "string", const: "paragraph" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      constructs: {
        type: "array",
        items: { $ref: "#/$defs/RunConstructExtent" },
      }, // the run-scoped construct extents this paragraph carries — see src/content.ts's own field comment for the block-marker/run-extent scope split
      styleId: { type: "string" }, // w:pStyle/@w:val, e.g. 'Heading1'
      codeLanguage: { type: "string" }, // the source-format language identifier of a code-styled block — see src/content.ts's own field comment
      preformatted: { type: "boolean" }, // whitespace inside this paragraph's own runs is significant and must survive verbatim — see src/content.ts's own field comment
      headingLevel: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      }, // canonical, format-agnostic heading depth — see src/content.ts's own field comment
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 }, // multiple of single line height
      indentLeftPt: { type: "number" },
      indentRightPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlpar/\ltrpar scope — see src/content.ts's own field comment
      pageBreakBefore: { type: "boolean" }, // explicit page boundaries a paragraph style forces around its own paragraph
      pageBreakAfter: { type: "boolean" },
      borders: { $ref: "#/$defs/ContentParagraphBorders" }, // direct paragraph-level border formatting — see src/content.ts's own field comment
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["kind", "runs"],
    additionalProperties: false,
  },
  ContentFloatOrigin: {
    type: "string",
    enum: [
      "page",
      "margin",
      "leftMargin",
      "rightMargin",
      "topMargin",
      "bottomMargin",
      "insideMargin",
      "outsideMargin",
      "column",
      "character",
      "paragraph",
      "line",
      "frame",
    ],
  },
  ContentFloatAlign: {
    type: "string",
    enum: ["left", "right", "top", "bottom", "center", "inside", "outside"],
  },
  ContentFloatAxis: {
    anyOf: [
      {
        type: "object",
        properties: {
          relativeTo: { $ref: "#/$defs/ContentFloatOrigin" },
          offsetPt: { type: "number" },
        },
        required: ["relativeTo", "offsetPt"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          relativeTo: { $ref: "#/$defs/ContentFloatOrigin" },
          align: { $ref: "#/$defs/ContentFloatAlign" },
        },
        required: ["relativeTo", "align"],
        additionalProperties: false,
      },
    ],
  },
  ContentFloatPosition: {
    type: "object",
    properties: {
      horizontal: { $ref: "#/$defs/ContentFloatAxis" },
      vertical: { $ref: "#/$defs/ContentFloatAxis" },
    },
    required: ["horizontal", "vertical"],
    additionalProperties: false,
  },
  // What this node's content IS, when the reader knows — see src/content.ts's ContentOriginSchema and the annotation-channel block above it.
  ContentOrigin: {
    type: "string",
    enum: ["chart", "diagram", "table", "image", "notes", "body"],
  },
  // A model's output about the node it is attached to — see src/content.ts's ContentInterpretationSchema. transcript is inline (its schema is not separately registered, so live generation inlines it here too).
  ContentInterpretation: {
    type: "object",
    properties: {
      transcript: {
        type: "object",
        properties: {
          text: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          mechanism: { type: "string", enum: ["deterministic", "model"] },
        },
        required: ["text", "confidence", "mechanism"],
        additionalProperties: false,
      },
      description: { type: "string" },
      by: {
        type: "object",
        properties: {
          model: { type: "string" },
          at: { type: "string" },
        },
        required: ["model", "at"],
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  // The source's own compressed bytes for a no-encoder image filter (JBIG2, JPEG 2000) — see src/content.ts's ContentImageOriginalSchema.
  ContentImageOriginal: {
    type: "object",
    properties: {
      filter: { type: "string", enum: ["jbig2", "jpeg2000"] },
      base64: { type: "string" },
      jbig2GlobalsBase64: { type: "string" },
    },
    required: ["filter", "base64"],
    additionalProperties: false,
  },
  ContentImageBlock: {
    type: "object",
    properties: {
      kind: { type: "string", const: "image" },
      format: { type: "string", enum: ["png", "jpeg", "svg", "gif"] },
      base64: { type: "string" },
      widthPt: { type: "number", exclusiveMinimum: 0 },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      altText: { type: "string" },
      original: { $ref: "#/$defs/ContentImageOriginal" },
      anchorRunIndex: {
        type: "integer",
        minimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      anchorOffset: {
        type: "integer",
        minimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      caption: { type: "string" },
      floatPosition: { $ref: "#/$defs/ContentFloatPosition" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["kind", "format", "base64", "widthPt", "heightPt"],
    additionalProperties: false,
  },
  ContentPageBreak: {
    type: "object",
    properties: {
      kind: { type: "string", const: "pageBreak" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  // ContentTableCellSchema/ContentTableColumnSchema/ContentTableRowSchema/ContentTableSchema are real, exported z.object() schemas, and ContentTableCellSchema.blocks reaches the now-real, self-recursive ContentBlockSchema through z.lazy() (ExaDev/documents.js#1009) rather than an opaque z.custom() node. Transcribed by hand here regardless, alongside ContentBlock itself, since content-json-schema-defs.test.ts's own REGISTERED_SCHEMAS registry holds all four (ContentBlockSchema included) to a live z.toJSONSchema() comparison together, the same registry-based $ref-reproducing construction every other cross-referencing fragment in this file already relies on.
  ContentTableCell: {
    type: "object",
    properties: {
      blocks: { type: "array", items: { $ref: "#/$defs/ContentBlock" } },
      colSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      rowSpan: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      background: { $ref: "#/$defs/ContentCellFill" },
      borders: { $ref: "#/$defs/ContentCellBorders" },
      verticalAlign: { type: "string", enum: ["top", "center", "bottom"] },
      formula: { type: "string" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["blocks"],
    additionalProperties: false,
  },
  ContentTableRow: {
    type: "object",
    properties: {
      // pptx tables carry an explicit row height (a:tr/@h); docx tables do not model one at the row level in the same way, so heightPt is undefined there (src/content.ts's own ContentTableRow comment).
      cells: { type: "array", items: { $ref: "#/$defs/ContentTableCell" } },
      heightPt: { type: "number", exclusiveMinimum: 0 },
      direction: { type: "string", enum: ["ltr", "rtl"] }, // RTF's \rtlrow/\ltrrow scope — see src/content.ts's own field comment
      isHeader: { type: "boolean" }, // this row is a header row — see THE HEADER RULE on src/content.ts's own ContentTableRow interface
    },
    required: ["cells"],
    additionalProperties: false,
  },
  // ContentTableColumnSchema (src/content.ts): nonnegative, not positive on widthPt, since both ooxml.js and odf.js's table readers deliberately default an unresolvable column's own width to 0 rather than omitting it, a real shape ExaDev/documents.js#1009's own real-corpus bijection gate confirmed live documents actually produce. isHeader is ODF's table:table-header-columns state (ExaDev/documents.js#1381); see ContentTable's own field comment (src/content.ts) for why only ODF ever states it.
  ContentTableColumn: {
    type: "object",
    properties: {
      widthPt: { type: "number", minimum: 0 },
      isHeader: { type: "boolean" },
    },
    required: ["widthPt"],
    additionalProperties: false,
  },
  ContentTable: {
    type: "object",
    properties: {
      kind: { type: "string", const: "table" },
      rows: { type: "array", items: { $ref: "#/$defs/ContentTableRow" } },
      columns: { type: "array", items: { $ref: "#/$defs/ContentTableColumn" } },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["kind", "rows", "columns"],
    additionalProperties: false,
  },
  // ContentEmbeddedObjectBlock extends ContentEmbeddedObject (src/content.ts): both are real, exported z.object() schemas now (ExaDev/documents.js#1009), transcribed by hand from CONTENT_EMBEDDED_OBJECT_FIELDS/ContentEmbeddedObjectBlockSchema. Deliberately excluded from content-json-schema-defs.test.ts's own live comparison, unlike every other fragment reachable through ContentBlockSchema: their `document` field's cross-file cycle back to ContentDocumentSchema produced an anonymous `#/$defs/__shared#/$defs/schemaN`-shaped ref rather than the CONTENT_DOCUMENT_URI stated below, once ContentDocumentSchema was registered alongside that test's other ~90 entries — confirmed empirically to work correctly in isolation (just these two schemas plus ContentDocumentSchema registered together), so this is a narrow, real interaction between Zod's own cyclic-schema handling and a large multi-schema registry, not the opacity that used to justify hand-transcribing everything below. See that test file's own top comment.
  ContentEmbeddedObjectBlock: {
    type: "object",
    properties: {
      kind: { type: "string", const: "embeddedObject" },
      objectKind: { type: "string", enum: EMBEDDED_OBJECT_KINDS },
      document: { $ref: CONTENT_DOCUMENT_URI },
      frame: { $ref: "#/$defs/Box" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      // Cell-anchor position, all four optional — only set on an embedded object held in a ContentSheetSchema.embeddedObjects array; mirrors ContentSheetImageSchema's own anchorRow/anchorColumn/offsetXPt/offsetYPt representation exactly (see schemas/content-document.schema.json's own ContentSheetImage fragment, generated — not hand-transcribed — since that schema is a real z.object()).
      anchorRow: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      anchorColumn: { type: "integer", minimum: 0, maximum: MAX_SAFE_INTEGER },
      offsetXPt: { type: "number" },
      offsetYPt: { type: "number" },
    },
    required: ["kind", "objectKind", "document", "frame"],
    additionalProperties: false,
  },
  // The flat form's two construct boundary markers (src/content.ts): a matched pair bracketing the extent a construct spans, which is how a codec emits construct data into the one shape it actually produces. Both are real z.objects reaching no opaque node, so both are held to the live comparison by content-json-schema-defs.test.ts. Neither carries frames, sourcePath, or a style ref — see the schemas' own comments for why a boundary has none of those facts to state.
  ContentConstructStart: {
    type: "object",
    properties: {
      kind: { type: "string", const: "constructStart" },
      descriptor: { $ref: "#/$defs/ConstructDescriptor" },
    },
    required: ["kind", "descriptor"],
    additionalProperties: false,
  },
  ContentConstructEnd: {
    type: "object",
    properties: {
      kind: { type: "string", const: "constructEnd" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  // ContentBlock itself (src/content.ts): `ContentParagraph | ContentTable | ContentImageBlock | ContentPageBreak | ContentEmbeddedObjectBlock | ContentConstructStart | ContentConstructEnd`, in that exact declared order.
  ContentBlock: {
    oneOf: [
      { $ref: "#/$defs/ContentParagraph" },
      { $ref: "#/$defs/ContentTable" },
      { $ref: "#/$defs/ContentImageBlock" },
      { $ref: "#/$defs/ContentPageBreak" },
      { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
      { $ref: "#/$defs/ContentConstructStart" },
      { $ref: "#/$defs/ContentConstructEnd" },
    ],
  },
  // The block leaf of the package tree (src/package-node.ts's TreeBlockLeaf): every ContentBlock member except the two boundary markers, which the tree refuses because it carries a construct as a group instead. Its own fragment rather than a reuse of ContentBlock above, so the published schema forbids exactly what the runtime guards forbid — a tree fragment pointing at ContentBlock would advertise marker leaves as legal to every non-TypeScript consumer while documentFromJson rejected them. A table cell's blocks keep pointing at ContentBlock: a table is one leaf, decomposition never descends into its cells, so a cell's list is flat in both encodings and a construct inside one is a marker pair there too.
  TreeBlockLeaf: {
    oneOf: [
      { $ref: "#/$defs/ContentParagraph" },
      { $ref: "#/$defs/ContentTable" },
      { $ref: "#/$defs/ContentImageBlock" },
      { $ref: "#/$defs/ContentPageBreak" },
      { $ref: "#/$defs/ContentEmbeddedObjectBlock" },
    ],
  },
  // — The package tree (src/package-node.ts), reached through DocumentTreeSchema's children --
  //
  // Everything in this block is here because the tree's group schemas are z.custom() guards z.toJSONSchema() cannot walk, so the descriptors, anchors, leaves, and wrappers underneath them exist only as these fragments. The descriptors, anchors, and leaves have real exported Zod counterparts built from the content schemas by omit+extend, and content-json-schema-defs.test.ts holds each to a live comparison; only the seven group wrappers (recursive through their children arrays) and ContentEmbeddedObject (the z.custom-backed interface with no z.object at all) are hand-verified alone.
  PageSize: {
    type: "object",
    properties: {
      widthPt: { type: "number", exclusiveMinimum: 0 },
      heightPt: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["widthPt", "heightPt"],
    additionalProperties: false,
  },
  Margins: {
    type: "object",
    properties: {
      topPt: { type: "number", minimum: 0 },
      rightPt: { type: "number", minimum: 0 },
      bottomPt: { type: "number", minimum: 0 },
      leftPt: { type: "number", minimum: 0 },
    },
    required: ["topPt", "rightPt", "bottomPt", "leftPt"],
    additionalProperties: false,
  },
  SectionDescriptor: {
    type: "object",
    properties: {
      pageSize: { $ref: "#/$defs/PageSize" },
      margins: { $ref: "#/$defs/Margins" },
      breakType: {
        type: "string",
        enum: ["nextPage", "continuous", "evenPage", "oddPage"],
      },
      headers: { $ref: "#/$defs/ContentPageFurniture" },
      footers: { $ref: "#/$defs/ContentPageFurniture" },
      watermarks: { $ref: "#/$defs/ContentPageFurniture" },
      source: { $ref: "#/$defs/SourceResidue" },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
      kind: { type: "string", const: "section" },
    },
    required: ["pageSize", "margins", "kind"],
    additionalProperties: false,
  },
  // The per-slot page-furniture block flows a ContentSection's headers/footers fields carry (src/content.ts's ContentPageFurnitureSchema). Hand-authored here for the same recursive reason as every other block-array shape: the slots hold ContentBlock, which is the hand-written structural guard in Zod and needs its JSON spelling stated alongside.
  ContentPageFurniture: {
    type: "object",
    properties: {
      default: { type: "array", items: { $ref: "#/$defs/ContentBlock" } },
      even: { type: "array", items: { $ref: "#/$defs/ContentBlock" } },
      first: { type: "array", items: { $ref: "#/$defs/ContentBlock" } },
    },
    additionalProperties: false,
  },
  SlideDescriptor: {
    type: "object",
    properties: {
      size: { $ref: "#/$defs/PageSize" },
      notes: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
      kind: { type: "string", const: "slide" },
    },
    required: ["size", "notes", "kind"],
    additionalProperties: false,
  },
  SheetDescriptor: {
    type: "object",
    properties: {
      name: { type: "string" },
      cells: { type: "array", items: { $ref: "#/$defs/ContentSheetCell" } },
      columns: { type: "array", items: { $ref: "#/$defs/ContentSheetColumn" } },
      rows: { type: "array", items: { $ref: "#/$defs/ContentSheetRow" } },
      printSettings: { $ref: "#/$defs/ContentSheetPrintSettings" },
      dataValidations: {
        type: "array",
        items: { $ref: "#/$defs/ContentSheetDataValidation" },
      },
      conditionalFormats: {
        type: "array",
        items: { $ref: "#/$defs/ContentSheetConditionalFormat" },
      },
      source: { $ref: "#/$defs/SourceResidue" },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
      kind: { type: "string", const: "sheet" },
    },
    required: ["name", "cells", "columns", "rows", "printSettings", "kind"],
    additionalProperties: false,
  },
  DrawPageDescriptor: {
    type: "object",
    properties: {
      size: { $ref: "#/$defs/PageSize" },
      source: { $ref: "#/$defs/SourceResidue" },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
      kind: { type: "string", const: "drawPage" },
    },
    required: ["size", "kind"],
    additionalProperties: false,
  },
  // A shape group's node payload — the one descriptor with no kind tag, since ContentShape carries none; identified structurally by its frame and insets. strictObject in the source (src/package-node.ts) is what rejects a raw flat ContentShape's blocks key here, matching additionalProperties: false plus blocks' absence.
  ShapeDescriptor: {
    type: "object",
    properties: {
      name: { type: "string" },
      frame: { $ref: "#/$defs/Box" },
      rotationDeg: { type: "number" },
      insetLeftPt: { type: "number", minimum: 0 },
      insetTopPt: { type: "number", minimum: 0 },
      insetRightPt: { type: "number", minimum: 0 },
      insetBottomPt: { type: "number", minimum: 0 },
      fontScale: { type: "number", exclusiveMinimum: 0 },
      lineSpacingReduction: { type: "number", minimum: 0 },
      paintOrder: { type: "number" },
      readingOrder: { type: "number" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: [
      "frame",
      "insetLeftPt",
      "insetTopPt",
      "insetRightPt",
      "insetBottomPt",
    ],
    additionalProperties: false,
  },
  // The heading-group anchor: ContentParagraphSchema's every field with headingLevel required (ContentParagraphSchema.extend in src/package-node.ts).
  HeadingParagraph: {
    type: "object",
    properties: {
      kind: { type: "string", const: "paragraph" },
      runs: { type: "array", items: { $ref: "#/$defs/ContentRun" } },
      constructs: {
        type: "array",
        items: { $ref: "#/$defs/RunConstructExtent" },
      },
      styleId: { type: "string" },
      codeLanguage: { type: "string" },
      preformatted: { type: "boolean" },
      headingLevel: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 },
      indentLeftPt: { type: "number" },
      indentRightPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      direction: { type: "string", enum: ["ltr", "rtl"] },
      pageBreakBefore: { type: "boolean" }, // explicit page boundaries a paragraph style forces around its own paragraph
      pageBreakAfter: { type: "boolean" },
      borders: { $ref: "#/$defs/ContentParagraphBorders" },
      sourcePath: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
      frames: { type: "array", items: { $ref: "#/$defs/LayoutFrame" } },
      origin: { $ref: "#/$defs/ContentOrigin" },
      interpretation: { $ref: "#/$defs/ContentInterpretation" },
    },
    required: ["kind", "runs", "headingLevel"],
    additionalProperties: false,
  },
  // The list-group anchor: ContentParagraphSchema's every field with list required.
};
