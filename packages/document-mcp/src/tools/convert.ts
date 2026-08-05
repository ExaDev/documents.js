import type { McpServer } from '@modelcontextprotocol/server';
import { base64ToBytes, createLocalDocumentConverter, DocumentFormatSchema, type FontSubstitution } from 'documents.js';
import { z } from 'zod';
import { DocumentInputSchema, resolveDocumentInput } from '../io/document-input';
import { DocumentOutputSchema, resolveDocumentOutput } from '../io/document-output';

// Mirrors document-schema.js's own `Diagnostic` (re-exported as a type-only `Diagnostic` from documents.js, with no accompanying Zod schema) -- the shape every DocumentConverter.convert() result reports through `diagnostics`, regardless of source/target format.
const DiagnosticSchema = z.object({
  severity: z.enum(['info', 'warning']),
  code: z.string(),
  message: z.string(),
  pageIndex: z.number().optional(),
});

// Mirrors pdf-codec's own `FontSubstitution`, re-exported as a type-only `FontSubstitution` from documents.js -- reported once per requested family/weight/style that resolved to a different face, when `onSubstitutionDiagnostics` is set below.
const FontSubstitutionSchema = z.object({
  requestedFamily: z.string(),
  requestedBold: z.boolean(),
  requestedItalic: z.boolean(),
  reason: z.enum(['missing-face', 'vendored-substitute']),
  resolvedFamily: z.string(),
});

// Mirrors ../io/document-output's `ResolvedDocumentOutput` union (`WrittenDocumentOutput | InlineDocumentOutput`) -- that module exports the type but not a Zod schema for it.
const ResolvedDocumentOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({ bytesBase64: z.string(), byteLength: z.number(), large: z.literal(true).optional() }),
]);

// A caller-supplied extra font face -- pdf-codec's `ProvidedFont` with its raw `bytes` field replaced by `bytesBase64`, matching DocumentInputSchema's own inline-bytes naming convention.
const FontInputSchema = z.object({
  family: z.string().describe('The font family name this face provides.'),
  bold: z.boolean().describe('Whether this face is the bold weight.'),
  italic: z.boolean().describe('Whether this face is the italic slope.'),
  bytesBase64: z.string().describe('Base64-encoded font program bytes (TrueType/OpenType/CFF) for this family/weight/style combination.'),
});

const ConvertDocumentInputSchema = z.object({
  source: DocumentInputSchema.describe('The document to convert.'),
  targetFormat: DocumentFormatSchema.describe(
    'The format to convert the document to. Not every (source, targetFormat) pair is supported directly -- call list_document_conversions first to confirm this one is.',
  ),
  output: DocumentOutputSchema.optional().describe('Where to write the converted document. Omit entirely to receive the bytes inline, base64-encoded, instead.'),
  fonts: z
    .array(FontInputSchema)
    .optional()
    .describe(
      'Extra font faces to make available to the conversion, for a family the source document does not already embed. Only consulted by a conversion that runs a layout engine (a <format>-to-pdf conversion); every other conversion ignores this option entirely.',
    ),
  onSubstitutionDiagnostics: z
    .boolean()
    .optional()
    .describe(
      'When true, additionally report each individual font-substitution event as structured fontSubstitutions (which family/weight/style was requested, what it resolved to instead, and why). Every substitution is always reported as a plain diagnostic in `diagnostics` regardless of this flag -- this only controls whether the fuller, structured event is also collected.',
    ),
  images: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'A map from a markdown image destination (the part in the parentheses of ![](..)) to its base64-encoded PNG/JPEG bytes, for resolving a markdown source\'s own non-data: images. Only consulted by a markdown-sourced conversion; every other conversion ignores it. A destination absent from the map degrades to alt text, matching documents.js\'s own MarkdownImageResolver port -- an MCP caller has no filesystem context to read a relative path from, so any image that is not a data: URI must be supplied here explicitly to be embedded.',
    ),
});

// The full structuredContent shape convert_document returns -- exported so a caller building on top of this module (or a test verifying the tool's real output against its own declared contract) can parse/narrow a result with it directly, rather than re-declaring an equivalent shape.
export const ConvertDocumentOutputSchema = z.object({
  targetFormat: DocumentFormatSchema,
  output: ResolvedDocumentOutputSchema,
  diagnostics: z.array(DiagnosticSchema),
  fontSubstitutions: z.array(FontSubstitutionSchema).optional(),
});

// The full structuredContent shape list_document_conversions returns -- exported for the same reason as ConvertDocumentOutputSchema above.
export const ListDocumentConversionsOutputSchema = z.object({
  conversions: z.array(z.object({ source: DocumentFormatSchema, target: DocumentFormatSchema })),
});

export function registerConvertTools(server: McpServer): void {
  // A fresh DocumentConverter per registration, not per call -- createLocalDocumentConverter() builds a plain, stateless dispatch table (see documents.js's own src/convert/local.ts), so there is nothing to gain from rebuilding it on every convert_document/list_document_conversions call, and both tools share the identical `conversions` list.
  const converter = createLocalDocumentConverter();

  server.registerTool(
    'convert_document',
    {
      title: 'Convert document',
      description:
        "Converts a document from one supported format to another via documents.js's DocumentConverter port -- docx, pptx, xlsx, odt, odp, ods, odg, odf, markdown, and pdf. Not every (source, targetFormat) pair is supported directly (odf, for instance, only ever converts to pdf); call list_document_conversions first to see which pairs actually are.",
      inputSchema: ConvertDocumentInputSchema,
      outputSchema: ConvertDocumentOutputSchema,
    },
    async ({ source, targetFormat, output, fonts, onSubstitutionDiagnostics, images }, ctx) => {
      const { signal } = ctx.mcpReq;
      const { bytes, format } = await resolveDocumentInput(source, { signal });

      const fontSubstitutions: FontSubstitution[] = [];
      const result = await converter.convert(
        { source: { format, bytes }, targetFormat },
        {
          signal,
          fonts: fonts?.map((font) => ({ family: font.family, bold: font.bold, italic: font.italic, bytes: base64ToBytes(font.bytesBase64) })),
          // Only wired under the flag: the local converter already records every substitution as a `font/substituted` Diagnostic in result.diagnostics below regardless of whether a callback is supplied, so an unconditional callback here would report the same event twice, once per channel.
          onFontSubstitution: onSubstitutionDiagnostics === true ? (substitution: FontSubstitution) => fontSubstitutions.push(substitution) : undefined,
          // An MCP caller has no filesystem context, so it supplies any non-data: markdown image bytes explicitly as a destination -> base64 map; a destination absent from the map degrades to alt text, exactly as documents.js's MarkdownImageResolver port defines.
          images: images === undefined ? undefined : (destination: string) => {
            const base64 = images[destination];
            return base64 === undefined ? undefined : { bytes: base64ToBytes(base64) };
          },
        },
      );

      const resolvedOutput = await resolveDocumentOutput(result.document.bytes, output ?? {});

      const structuredContent: z.infer<typeof ConvertDocumentOutputSchema> = {
        targetFormat: result.document.format,
        output: resolvedOutput,
        diagnostics: [...result.diagnostics],
        ...(onSubstitutionDiagnostics === true ? { fontSubstitutions: [...fontSubstitutions] } : {}),
      };

      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    },
  );

  server.registerTool(
    'list_document_conversions',
    {
      title: 'List document conversions',
      description:
        "Lists every (source, target) format pair convert_document actually supports, straight from documents.js's own DocumentConverter port -- the definitive source of truth for what convert_document will and will not accept as a (source, targetFormat) combination.",
      outputSchema: ListDocumentConversionsOutputSchema,
    },
    () => {
      const structuredContent: z.infer<typeof ListDocumentConversionsOutputSchema> = {
        conversions: converter.conversions.map((conversion) => ({ source: conversion.source, target: conversion.target })),
      };

      return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
    },
  );
}
