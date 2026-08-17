import type { ContentDocument, LayoutDocument, LayoutMetadata } from 'document-schema.js';
import type { MarkdownImageResolver } from 'markdown-codec';
import { readPdf, writePdf } from 'pdf-codec';
import { DOCUMENT_FORMAT_CODECS, requireArrayBufferBytes } from '../codecs/registry';
import type { DocumentCodecOptions } from '../codecs/registry';
import type { DocumentFormat } from '../convert/port';
import { throwIfAborted } from '../ports/abort';

// Every format whose own ContentDocument setDocumentMetadata can patch a metadata field on and rebuild from scratch through -- the eight formats sharing the readXContent -> buildXPackage round trip. xlsx joined this set once DOCUMENT_FORMAT_CODECS.xlsx.content gained a real read/write pair (src/codecs/registry.ts): it now fits the identical shape docx/pptx/odt/odp/ods/odg/markdown already share, so there is no reason left to special-case it out. Deliberately does NOT include 'pdf': a PDF's metadata is patched directly on its own LayoutDocument (see setDocumentMetadata below), never through this ContentDocument rebuild path at all. Nor 'csv': a csv round trip technically exists through the registry codec, but RFC 4180 text has no metadata container at all -- a rebuild would "succeed" and silently drop the override -- so classifyWritePath rejects it explicitly below with that reason rather than letting it fall through to the generic format-mismatch message.
const REBUILD_FORMATS: Readonly<Record<'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'odg' | 'markdown' | 'xlsx', true>> = {
  docx: true,
  pptx: true,
  odt: true,
  odp: true,
  ods: true,
  odg: true,
  markdown: true,
  xlsx: true,
};

type RebuildFormat = keyof typeof REBUILD_FORMATS;

function isRebuildFormat(format: DocumentFormat): format is RebuildFormat {
  return format in REBUILD_FORMATS;
}

// Both functions below dispatch through DOCUMENT_FORMAT_CODECS (src/codecs/registry.ts) rather than a hand-written per-format switch. Every RebuildFormat member has a real `content` codec in that registry (it's exactly the docx/pptx/odt/odp/ods/odg/markdown subset the registry itself populates one), so the fallback throws are internal-invariant guards for TypeScript's benefit, never expected to fire.
function readContentForFormat(format: RebuildFormat, bytes: Uint8Array<ArrayBuffer>, options: DocumentCodecOptions): ContentDocument {
  const content = DOCUMENT_FORMAT_CODECS[format].content;
  if (!content) {
    throw new Error(`RebuildFormat '${format}' has no content codec in DOCUMENT_FORMAT_CODECS -- this is an internal invariant violation, not a caller error`);
  }
  return content.read(bytes, options);
}

function buildBytesForRebuildFormat(format: RebuildFormat, content: ContentDocument): Uint8Array<ArrayBuffer> {
  const codec = DOCUMENT_FORMAT_CODECS[format].content;
  if (!codec?.write) {
    throw new Error(`RebuildFormat '${format}' has no content.write codec in DOCUMENT_FORMAT_CODECS -- this is an internal invariant violation, not a caller error`);
  }
  return requireArrayBufferBytes(codec.write(content));
}

export interface MetadataOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  // Mutable, matching LayoutMetadataSchema's own `keywords?: string[]` (document-schema.js) -- mergeMetadata's return must satisfy that shape exactly, and a `readonly string[]` here would not.
  readonly keywords?: string[];
}

// Object-spreads the current metadata with only the overrides the caller actually passed. A field genuinely absent from `overrides` (as opposed to present with an empty-string/empty-array value) leaves that field exactly as the source document already had it, rather than clearing it -- each override is its own conditional spread rather than a bare `title: overrides.title ?? current.title`, so a caller that never mentions a field cannot be told apart from one that explicitly wants it set to empty.
function mergeMetadata(current: LayoutMetadata, overrides: MetadataOverrides): LayoutMetadata {
  return {
    ...current,
    ...(overrides.title !== undefined ? { title: overrides.title } : {}),
    ...(overrides.author !== undefined ? { author: overrides.author } : {}),
    ...(overrides.subject !== undefined ? { subject: overrides.subject } : {}),
    ...(overrides.keywords !== undefined ? { keywords: overrides.keywords } : {}),
  };
}

type WritePath = { readonly kind: 'pdf' } | { readonly kind: 'rebuild'; readonly format: RebuildFormat } | { readonly errorMessage: string };

// setDocumentMetadata deliberately does not convert format: its own job is patching metadata in place, not choosing a target format, so source and target must resolve to the identical format -- 'pdf' direct-patches its own LayoutDocument (no ContentDocument, no layout engine, genuinely lossless for everything else on the page), every other REBUILD_FORMATS member rebuilds a fresh package from its own ContentDocument (lossy wherever that format's own build function is -- see buildDocxPackage's own docx-extras gotcha: comments, footnotes, headers/footers, and numbering definitions do not survive the rebuild, since buildDocxPackage builds a fresh package from the ContentDocument alone, with no way to carry that data through). xlsx now rebuilds through this same path, via DOCUMENT_FORMAT_CODECS.xlsx.content (ooxml.js's readXlsxContent/buildXlsxPackage, src/codecs/registry.ts) -- it is no longer rejected. odf (a standalone formula document) is still rejected outright in both directions, since it has no write path back out at all. A caller wanting to change format and metadata together should convert first (e.g. via buildDocumentBytes or one of the ergonomic X-to-Y conversions), then call setDocumentMetadata on the result.
function classifyWritePath(source: DocumentFormat, target: DocumentFormat): WritePath {
  if (source === 'pdf' && target === 'pdf') {
    return { kind: 'pdf' };
  }
  if (target === 'odf' || source === 'odf') {
    return { errorMessage: "'odf' (a standalone formula document) is not a supported setDocumentMetadata source or target -- it has no write path back out at all" };
  }
  if (target === 'csv' || source === 'csv') {
    return { errorMessage: "'csv' is not a supported setDocumentMetadata source or target -- RFC 4180 text has no metadata container, so a rebuild would silently drop the override. Convert to or from csv first, then patch metadata on the package format." };
  }
  if (!isRebuildFormat(source) || !isRebuildFormat(target)) {
    return { errorMessage: `setDocumentMetadata only patches metadata in place; it does not convert format -- source ('${source}') and target ('${target}') must be the same format (or both 'pdf'). Convert first if you need a different target format.` };
  }
  if (source !== target) {
    return { errorMessage: `setDocumentMetadata only patches metadata in place; it does not convert format -- source ('${source}') and target ('${target}') must be the same format. Convert first if you need a different target format.` };
  }
  return { kind: 'rebuild', format: source };
}

export interface SetDocumentMetadataOptions {
  readonly signal?: AbortSignal;
  // A MarkdownImageResolver forwarded to the markdown content codec's read during a markdown rebuild -- so patching a markdown document's metadata does not silently drop its non-data: images (they would degrade to alt text without a resolver, since the rebuild re-reads the markdown). Ignored by every non-markdown format. Same shape and rationale as DocumentToPdfOptions.images / ConversionOptions.images.
  readonly images?: MarkdownImageResolver;
}

// Patches a document's own title/author/subject/keywords, leaving every other field and every other flag as-is. Two write paths: a pdf source/target patches the metadata directly on the parsed PDF (writePdf), with no layout engine involved at all -- genuinely lossless for everything else on the page. Every other supported format (docx, pptx, xlsx, odt, odp, ods, odg, markdown) rebuilds a fresh package from that format's own ContentDocument -- see classifyWritePath's own comment for exactly what that costs for docx specifically. Overrides are applied via mergeMetadata: a field omitted from `overrides` is left exactly as the source document already had it.
export function setDocumentMetadata(sourceFormat: DocumentFormat, targetFormat: DocumentFormat, bytes: Uint8Array<ArrayBuffer>, overrides: MetadataOverrides, options?: SetDocumentMetadataOptions): Uint8Array<ArrayBuffer> {
  const writePath = classifyWritePath(sourceFormat, targetFormat);
  if ('errorMessage' in writePath) {
    throw new Error(writePath.errorMessage);
  }

  throwIfAborted(options?.signal);

  if (writePath.kind === 'pdf') {
    const layout: LayoutDocument = readPdf(bytes, { signal: options?.signal });
    const patched: LayoutDocument = { ...layout, metadata: mergeMetadata(layout.metadata, overrides) };
    return writePdf(patched, { signal: options?.signal });
  }

  const content = readContentForFormat(writePath.format, bytes, { signal: options?.signal, images: options?.images });
  const nextContent: ContentDocument = { ...content, metadata: mergeMetadata(content.metadata, overrides) };
  return buildBytesForRebuildFormat(writePath.format, nextContent);
}
