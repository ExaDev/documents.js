// Hand-transcribed JSON Schema fragments for the $defs map, split from content-json-schema-defs.ts (see that module for the transcription discipline and the live-comparison regression suite). Merged into CONTENT_DEFS by property descriptor so this part occupies its exact place in the key order.
import { type JsonSchema, MAX_SAFE_INTEGER } from "./json-schema-defs-shared";

export const DEFS_TREE: Record<string, JsonSchema> = {
  ContentControlDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "contentControl" },
      controlType: {
        type: "string",
        enum: [
          "richText",
          "plainText",
          "checkbox",
          "dropDown",
          "comboBox",
          "date",
          "picture",
          "repeatingSection",
          "button",
          "index",
          "group",
        ],
      },
      tag: { type: "string" },
      alias: { type: "string" },
      lock: { type: "string", enum: ["content", "container", "both"] },
      value: { type: "string" },
      checked: { type: "boolean" },
      options: { type: "array", items: { type: "string" } },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "controlType"],
    additionalProperties: false,
  },
  FieldDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "field" },
      instruction: { type: "string" },
      cachedResult: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "instruction"],
    additionalProperties: false,
  },
  AnchorDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "anchor" },
      anchorType: {
        type: "string",
        enum: ["bookmark", "footnote", "endnote", "comment"],
      },
      name: { type: "string" },
      definition: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "anchorType", "name"],
    additionalProperties: false,
  },
  LinkTarget: {
    oneOf: [
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "external" },
          uri: { type: "string" },
        },
        required: ["kind", "uri"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          kind: { type: "string", const: "internal" },
          anchor: { type: "string" },
        },
        required: ["kind", "anchor"],
        additionalProperties: false,
      },
    ],
  },
  LinkDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "link" },
      target: { $ref: "#/$defs/LinkTarget" },
      title: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "target"],
    additionalProperties: false,
  },
  ProvenanceDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "provenance" },
      change: {
        type: "string",
        enum: ["insertion", "deletion", "moveFrom", "moveTo", "formatChange"],
      },
      author: { type: "string" },
      dateIso: { type: "string" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind", "change"],
    additionalProperties: false,
  },
  DivisionSource: {
    type: "object",
    properties: { href: { type: "string" }, sectionName: { type: "string" } },
    required: ["href"],
    additionalProperties: false,
  },
  DivisionDescriptor: {
    type: "object",
    properties: {
      kind: { type: "string", const: "division" },
      name: { type: "string" },
      columnCount: {
        type: "integer",
        exclusiveMinimum: 0,
        maximum: MAX_SAFE_INTEGER,
      },
      protected: { type: "boolean" },
      linked: { $ref: "#/$defs/DivisionSource" },
      source: { $ref: "#/$defs/SourceResidue" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  ConstructDescriptor: {
    oneOf: [
      { $ref: "#/$defs/ContentControlDescriptor" },
      { $ref: "#/$defs/FieldDescriptor" },
      { $ref: "#/$defs/AnchorDescriptor" },
      { $ref: "#/$defs/LinkDescriptor" },
      { $ref: "#/$defs/ProvenanceDescriptor" },
      { $ref: "#/$defs/DivisionDescriptor" },
    ],
  },
  // — The definitions facility (src/definitions.ts), reached through DocumentTreeSchema's styles/definitions fields and, since 4.1.0, its layers/attachments/destinations tables --
  StyleParagraphProperties: {
    type: "object",
    properties: {
      alignment: { $ref: "#/$defs/Alignment" },
      list: { $ref: "#/$defs/ContentListMembership" },
      spacingBeforePt: { type: "number" },
      spacingAfterPt: { type: "number" },
      lineSpacing: { type: "number", exclusiveMinimum: 0 },
      indentLeftPt: { type: "number" },
      indentFirstLinePt: { type: "number" },
      pageBreakBefore: { type: "boolean" }, // the page-boundary flags ContentParagraph carries — the styles-table spelling of a paragraph style that forces a page break
      pageBreakAfter: { type: "boolean" },
    },
    additionalProperties: false,
  },
  StyleRunProperties: {
    type: "object",
    properties: {
      bold: { type: "boolean" },
      italic: { type: "boolean" },
      underline: { type: "boolean" },
      strike: { type: "boolean" },
      fontFamily: { type: "string" },
      sizePt: { type: "number", exclusiveMinimum: 0 },
      color: { $ref: "#/$defs/Color" },
    },
    additionalProperties: false,
  },
  StyleEntry: {
    type: "object",
    properties: {
      paragraph: { $ref: "#/$defs/StyleParagraphProperties" },
      run: { $ref: "#/$defs/StyleRunProperties" },
    },
    additionalProperties: false,
  },
  // A tenant-generic definitions-table entry: a required `kind` discriminator plus an open body whose keys belong to the tenant's vocabulary, never this package's — the empty additionalProperties schema is JSON Schema's "anything", the emitted form of z.looseObject (src/definitions.ts).
  DefinitionEntry: {
    type: "object",
    properties: {
      kind: { type: "string" },
    },
    required: ["kind"],
    additionalProperties: {},
  },
};
