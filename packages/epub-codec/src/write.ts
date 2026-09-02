import {
  ConstructMarkerImbalanceError,
  flattenTree,
  type ContentDocument,
  type ContentSection,
  type DocumentTree,
} from "document-schema.js";
import {
  EpubPackageFlattenError,
  EpubUnbalancedConstructMarkersError,
  EpubUnsupportedDocumentKindError,
  NOOP_EPUB_DIAGNOSTIC_SINK,
  type EpubDiagnosticSink,
} from "./diagnostics";
import {
  EPUB_MIME_TYPE,
  OCF_CONTAINER_PATH,
  OCF_MIMETYPE_PATH,
} from "./format";
import { writeContainerXml } from "./ocf/write";
import { writeNav3Document, type NavSectionEntry } from "./nav/write";
import type { OpfManifestItem } from "./opf/types";
import { writeOpf } from "./opf/write";
import { writeXhtmlBody } from "./xhtml/write";
import { buildXml } from "./xml/build";
import type { XmlElement } from "./xml/node";
import { zipPackage, type ZipEntry } from "./zip";

// The public write entry points: writeEpubContent (the primary API -- a flat ContentDocument in, a minimal valid EPUB 3 out) and writeEpub (flattenTree composed on top, for a caller holding a DocumentTree instead -- matching markdown-codec's own dual-level API and readEpub's own tree/flat pairing in src/read.ts). Only EPUB 3 is ever written (ExaDev/documents.js#801's own explicit scope: EPUB 2 is read-only), and only a 'wordprocessing' document -- EPUB has no presentation/spreadsheet/drawing/formula analogue.

export interface WriteEpubOptions {
  readonly sink?: EpubDiagnosticSink;
}

const OPF_DIR = "OEBPS";
const OPF_PATH = `${OPF_DIR}/content.opf`;
const NAV_PATH = `${OPF_DIR}/nav.xhtml`;
const XHTML_DOCTYPE =
  '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">';

function sectionXhtmlPath(index: number): string {
  return `${OPF_DIR}/section${String(index + 1)}.xhtml`;
}

function imageExtension(format: "png" | "jpeg"): string {
  return format === "png" ? "png" : "jpg";
}

function imageMediaType(format: "png" | "jpeg"): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

export function writeEpubContent(
  document: ContentDocument,
  options: WriteEpubOptions = {},
): Uint8Array<ArrayBuffer> {
  if (document.kind !== "wordprocessing") {
    throw new EpubUnsupportedDocumentKindError(document.kind);
  }
  const sink = options.sink ?? NOOP_EPUB_DIAGNOSTIC_SINK;

  const registeredImages: {
    href: string;
    bytes: Uint8Array<ArrayBuffer>;
    mediaType: string;
  }[] = [];
  const registerImage = (
    bytes: Uint8Array<ArrayBuffer>,
    format: "png" | "jpeg",
  ): string => {
    const index = registeredImages.length + 1;
    const href = `images/img${String(index)}.${imageExtension(format)}`;
    registeredImages.push({ href, bytes, mediaType: imageMediaType(format) });
    return href;
  };

  const sectionXhtmlBodies: XmlElement[] = [];
  document.sections.forEach((section: ContentSection, index) => {
    const sourceHref = sectionXhtmlPath(index);
    try {
      sectionXhtmlBodies.push(
        writeXhtmlBody(section.blocks, {
          registerImage,
          sink,
          sourceHref,
        }),
      );
    } catch (error) {
      if (error instanceof ConstructMarkerImbalanceError) {
        throw new EpubUnbalancedConstructMarkersError(
          error.imbalance.kind,
          error.imbalance.index,
        );
      }
      throw error;
    }
  });

  const navEntries: NavSectionEntry[] = document.sections.map(
    (section, index) => ({
      href: `section${String(index + 1)}.xhtml`,
      section,
    }),
  );

  const manifestItems: OpfManifestItem[] = [
    {
      id: "nav",
      href: "nav.xhtml",
      mediaType: "application/xhtml+xml",
      properties: ["nav"],
    },
    ...document.sections.map((_section, index) => ({
      id: `s${String(index + 1)}`,
      href: `section${String(index + 1)}.xhtml`,
      mediaType: "application/xhtml+xml",
      properties: [],
    })),
    ...registeredImages.map((image, index) => ({
      id: `img${String(index + 1)}`,
      href: image.href,
      mediaType: image.mediaType,
      properties: [],
    })),
  ];

  const opfXml = writeOpf({
    metadata: document.metadata,
    manifestItems,
    spineIdrefs: document.sections.map(
      (_section, index) => `s${String(index + 1)}`,
    ),
    identifier: `urn:uuid:${crypto.randomUUID()}`,
  });

  const entries: [string, ZipEntry][] = [
    [
      OCF_MIMETYPE_PATH,
      {
        bytes: new TextEncoder().encode(EPUB_MIME_TYPE),
        stored: true,
      },
    ],
    [
      OCF_CONTAINER_PATH,
      {
        bytes: new TextEncoder().encode(writeContainerXml(OPF_PATH)),
      },
    ],
    [OPF_PATH, { bytes: new TextEncoder().encode(opfXml) }],
    [
      NAV_PATH,
      {
        bytes: new TextEncoder().encode(writeNav3Document(navEntries)),
      },
    ],
  ];
  sectionXhtmlBodies.forEach((body, index) => {
    const xml = `${XHTML_DOCTYPE}${buildXml([body])}</html>`;
    entries.push([
      sectionXhtmlPath(index),
      { bytes: new TextEncoder().encode(xml) },
    ]);
  });
  for (const image of registeredImages) {
    entries.push([`${OPF_DIR}/${image.href}`, { bytes: image.bytes }]);
  }

  return zipPackage(entries);
}

export function writeEpub(
  tree: DocumentTree,
  options: WriteEpubOptions = {},
): Uint8Array<ArrayBuffer> {
  // Checked before flattening, matching markdown-codec's identical writeMarkdown precedent: every non-'wordprocessing' kind reaches this same error the same way, rather than some failing inside flattenTree with a kind-specific message and others reaching writeEpubContent's own (later, redundant) check.
  if (tree.kind !== "wordprocessing") {
    throw new EpubUnsupportedDocumentKindError(tree.kind);
  }
  let flat: ContentDocument;
  try {
    flat = flattenTree(tree);
  } catch (error) {
    throw new EpubPackageFlattenError(error);
  }
  return writeEpubContent(flat, options);
}
