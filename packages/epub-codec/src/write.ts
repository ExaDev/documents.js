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
import {
  sectionTitle,
  writeNav3Document,
  type NavSectionEntry,
} from "./nav/write";
import type { OpfManifestItem } from "./opf/types";
import { writeOpf } from "./opf/write";
import { writeXhtmlBody } from "./xhtml/write";
import { buildXml } from "./xml/build";
import { encodeEntities } from "./xml/entities";
import type { XmlElement, XmlNode } from "./xml/node";
import { parseXml } from "./xml/parse";
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

// Builds one section's own <head>: a required <title> (EPUB 3.3's own XHTML content document conformance, matching every real producer's output even though this package's own reader never checks for one) plus, when this section carries its own quarantined CSS residue (src/xhtml/read.ts's STYLE_RESIDUE), that residue's raw <link>/<style> elements re-parsed and spliced back in verbatim.
function buildHead(title: string, residueXml: string | undefined): XmlElement {
  const titleElement: XmlElement = {
    type: "element",
    tag: "title",
    attributes: [],
    children: [{ type: "text", value: encodeEntities(title) }],
  };
  const residueNodes: XmlNode[] =
    residueXml === undefined ? [] : parseXml(residueXml);
  return {
    type: "element",
    tag: "head",
    attributes: [],
    children: [titleElement, ...residueNodes],
  };
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

  const sectionXhtml: { body: XmlElement; residueXml: string | undefined }[] =
    [];
  document.sections.forEach((section: ContentSection, index) => {
    const sourceHref = sectionXhtmlPath(index);
    try {
      const body = writeXhtmlBody(section.blocks, {
        registerImage,
        sink,
        sourceHref,
      });
      // A same-format (EPUB-to-EPUB) restorable-fidelity re-emission of this package's own CSS residue (src/xhtml/read.ts's own STYLE_RESIDUE quarantine): the raw <link rel="stylesheet">/<style> elements this section's own source XHTML carried, re-parsed and spliced back into the written <head> verbatim, never interpreted -- matching this whole family's residue-channel contract (document-schema.js's own "a same-format writer may re-emit its own residue verbatim").
      const residueXml =
        section.source?.format === "epub" ? section.source.xml : undefined;
      sectionXhtml.push({ body, residueXml });
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
  sectionXhtml.forEach(({ body, residueXml }, index) => {
    const section = document.sections[index];
    const head = buildHead(
      section === undefined
        ? `Section ${String(index + 1)}`
        : sectionTitle(section, index),
      residueXml,
    );
    const xml = `${XHTML_DOCTYPE}${buildXml([head, body])}</html>`;
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
