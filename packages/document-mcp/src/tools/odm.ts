import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  base64ToBytes,
  OdmUnresolvedSectionError,
  odmToPdf,
} from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";
import {
  DocumentOutputSchema,
  resolveDocumentOutput,
} from "../io/document-output";

// documents.js's own DocumentFormat enum (see DocumentInputSchema in ../io/document-input) deliberately has no 'odm' member -- a .odm master document is never wired into the DocumentConverter port at all, since odmToPdf needs a caller-supplied resolveSubDocument callback no other conversion does (see documents.js's own README, "odmToPdf is the one conversion in this package that is not purely bytes-in/bytes-out"). The shared hybrid DocumentInputSchema can therefore not represent a .odm source at all: inferFormatFromExtension has no '.odm' entry, and the inline-bytes variant's `format` field has no 'odm' option either. The master document gets its own minimal path-or-inline-bytes union instead -- structurally the same path/bytesBase64 shape, just without a format label a fixed-format input has no use for.
const OdmMasterSourceSchema = z.union([
  z.object({
    path: z
      .string()
      .describe("Filesystem path to the .odm master document to convert."),
  }),
  z.object({
    bytesBase64: z
      .string()
      .describe("Base64-encoded .odm master document bytes."),
  }),
]);

async function resolveOdmMasterBytes(
  source: z.infer<typeof OdmMasterSourceSchema>,
): Promise<Uint8Array<ArrayBuffer>> {
  if ("path" in source) {
    return new Uint8Array(await readFile(source.path));
  }
  return base64ToBytes(source.bytesBase64);
}

// Unlike the master document, a chapter IS representable by the shared DocumentInputSchema -- odt is a real DocumentFormat member -- so this reuses it directly rather than a bespoke schema. odmToPdf's own resolveSubDocument contract always reads the resolved bytes as odt regardless of any format label a caller supplies (see documents.js's src/convert/convert.ts: every resolved chapter is decoded via odf.js's decodePackage then readOdtContent), so only `.bytes` is ever used below -- the resolved `.format` is not itself load-bearing.
const OdmChapterInputSchema = z.object({
  href: z
    .string()
    .describe(
      "The chapter's own text:section-source href as declared inside the .odm master document (e.g. '../chapter1.odt').",
    ),
  source: DocumentInputSchema.describe(
    "The chapter document's own bytes -- always read as odt, regardless of the format this hybrid input declares.",
  ),
});

const OdmToPdfInputSchema = z.object({
  source: OdmMasterSourceSchema.describe(
    "The .odm master document to convert.",
  ),
  chapters: z
    .array(OdmChapterInputSchema)
    .default([])
    .describe(
      "Explicit href -> chapter document overrides. Checked before chaptersDir for a given href.",
    ),
  chaptersDir: z
    .string()
    .optional()
    .describe(
      "Directory to search for each unresolved chapter href, matched by the href's own basename. Checked after chapters.",
    ),
  output: DocumentOutputSchema.default({}).describe(
    "Where to write the resulting PDF. Omit to receive the bytes inline, base64-encoded.",
  ),
});

// Mirrors ../io/document-output's ResolvedDocumentOutput return shape as a real Zod schema, matching this repo's own src/tools/convert.ts convention (ResolvedDocumentOutputSchema) -- lets registerTool validate/type a successful result via outputSchema, and lets a caller (this file's own test included) parse result.structuredContent without an unsafe cast. Output validation is skipped by the SDK whenever a result carries isError: true (see McpServer.validateToolOutput), so this schema describes only the success shape -- the OdmUnresolvedSectionError branch below returns a differently-shaped structuredContent and is unaffected by it.
export const OdmToPdfOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
  }),
]);

export function registerOdmTools(server: McpServer): void {
  server.registerTool(
    "odm_to_pdf",
    {
      title: "Convert ODM master document to PDF",
      description:
        "Converts a .odm (ODF master document) to PDF. A .odm never carries its own chapters' content inline -- every text:section is a bare external reference to a standalone .odt file -- so each chapter the master document declares must resolve through `chapters` (an explicit href -> document override) and/or `chaptersDir` (a directory searched by the href's own basename), checked in that order. A chapter left unresolved by both fails the whole conversion, naming every unresolved href.",
      inputSchema: OdmToPdfInputSchema,
      outputSchema: OdmToPdfOutputSchema,
    },
    async ({ source, chapters, chaptersDir, output }) => {
      const masterBytes = await resolveOdmMasterBytes(source);

      // Pre-resolves every explicit chapters override up front, since odmToPdf's own resolveSubDocument callback is synchronous -- called from within a synchronous read pass, not awaited (see OdmToPdfOptions in documents.js) -- so no hybrid-input resolution (a file read or a base64 decode) can happen lazily inside it.
      const overrides = new Map<string, Uint8Array<ArrayBuffer>>();
      for (const chapter of chapters) {
        const { bytes: chapterBytes } = await resolveDocumentInput(
          chapter.source,
        );
        overrides.set(chapter.href, chapterBytes);
      }

      // The same precedence document-cli's own odm-to-pdf command uses (createResolveSubDocument, src/commands/odm.ts): an explicit chapters override by href first, then chaptersDir joined with the href's own basename, then undefined -- letting odmToPdf's own OdmUnresolvedSectionError collection do its job.
      const resolveSubDocument = (
        href: string,
      ): Uint8Array<ArrayBuffer> | undefined => {
        const overrideBytes = overrides.get(href);
        if (overrideBytes !== undefined) {
          return overrideBytes;
        }
        if (chaptersDir === undefined) {
          return undefined;
        }
        const candidate = join(chaptersDir, basename(href));
        if (!existsSync(candidate)) {
          return undefined;
        }
        return new Uint8Array(readFileSync(candidate));
      };

      try {
        const pdfBytes = odmToPdf(masterBytes, { resolveSubDocument });
        const result = await resolveDocumentOutput(pdfBytes, output);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        if (error instanceof OdmUnresolvedSectionError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `${error.message}\nPass chaptersDir <dir> containing these files, or an explicit chapters override, for each href.`,
              },
            ],
            structuredContent: { hrefs: error.hrefs },
          };
        }
        throw error;
      }
    },
  );
}
