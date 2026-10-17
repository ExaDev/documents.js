import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Form from "./form";
import type * as Navigation from "./navigation";
import type * as OptionalContent from "./optional-content";
import type * as Structure from "./structure";
import type { PdfDiagnostic } from "./diagnostics";
import { readAcroForm } from "./form";
import type {
  LayoutDocument,
  LayoutDocumentSurface,
  LayoutItem,
  LayoutOutlineItem,
  LayoutPage,
} from "./layout";
import { LayoutDocumentSchema, LayoutDocumentSurfaceSchema } from "./layout";
import { createDestinationRegistry, readOutline } from "./navigation";
import { readOptionalContent } from "./optional-content";
import type { ReadPdfSurfaces } from "./read";
import { readPdf } from "./read";
import { readStructure } from "./structure";
import { PdfPartialDocumentError, writePdf } from "./write";
import { PdfSkippedSurfacesError } from "./write-skipped-surfaces";
import {
  DOCUMENT_SURFACE_TRAP_OBJECTS,
  documentSurfacesPdf,
} from "./test-support/pdf-surfaces";

// Each document-level surface reader, wrapped so a test can see whether a read entered it. The real implementations still run: these observe, they do not stub.
vi.mock("./navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof Navigation>();
  return {
    ...actual,
    createDestinationRegistry: vi.fn(actual.createDestinationRegistry),
    readOutline: vi.fn(actual.readOutline),
  };
});
vi.mock("./form", async (importOriginal) => {
  const actual = await importOriginal<typeof Form>();
  return { ...actual, readAcroForm: vi.fn(actual.readAcroForm) };
});
vi.mock("./optional-content", async (importOriginal) => {
  const actual = await importOriginal<typeof OptionalContent>();
  return { ...actual, readOptionalContent: vi.fn(actual.readOptionalContent) };
});
vi.mock("./structure", async (importOriginal) => {
  const actual = await importOriginal<typeof Structure>();
  return { ...actual, readStructure: vi.fn(actual.readStructure) };
});

const SURFACES = LayoutDocumentSurfaceSchema.options;

type ReaderSurface = Exclude<LayoutDocumentSurface, "residue">;

// The reader each surface's parse starts in; residue is read by read.ts itself and is covered by its trap alone.
const SURFACE_READERS: Readonly<Record<ReaderSurface, () => unknown>> = {
  outline: () => readOutline,
  destinations: () => createDestinationRegistry,
  form: () => readAcroForm,
  layers: () => readOptionalContent,
  structure: () => readStructure,
};

// The LayoutDocument field each surface fills.
const SURFACE_FIELD = {
  outline: "outline",
  destinations: "destinations",
  form: "form",
  layers: "layers",
  structure: "structure",
  residue: "source",
} as const satisfies Record<LayoutDocumentSurface, keyof LayoutDocument>;

function only(surface: LayoutDocumentSurface): ReadPdfSurfaces {
  return { [surface]: false };
}

const NONE: ReadPdfSurfaces = Object.fromEntries(
  SURFACES.map((surface) => [surface, false]),
);

function readWith(
  surfaces: ReadPdfSurfaces | undefined,
  pages?: readonly number[],
): { readonly doc: LayoutDocument; readonly diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  const doc = readPdf(documentSurfacesPdf(), {
    surfaces,
    pages,
    sink: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });
  return { doc, diagnostics };
}

// The trap object numbers a read's diagnostics name, sorted.
function trapsReported(diagnostics: readonly PdfDiagnostic[]): number[] {
  return Object.values(DOCUMENT_SURFACE_TRAP_OBJECTS)
    .filter((num) =>
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes(`object ${String(num)} `),
      ),
    )
    .sort((a, b) => a - b);
}

// An item, page or document as a plain record minus one field: what a skipped surface's result is compared against, field by field.
function withoutField(value: object, field: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  );
}

function mapItems(
  pages: readonly LayoutPage[],
  map: (items: readonly LayoutItem[]) => readonly object[],
): Record<string, unknown>[] {
  return pages.map((page) => ({ ...page, items: map(page.items) }));
}

function withoutDestinations(
  outline: readonly LayoutOutlineItem[],
): Record<string, unknown>[] {
  return outline.map((item) => ({
    ...withoutField(item, "destination"),
    children: withoutDestinations(item.children),
  }));
}

// What a full read becomes with one surface skipped, by the rules ReadPdfOptions.surfaces states: the surface's field is gone and named in skippedSurfaces, and page items (and, for destinations, outline entries) lose exactly what depended on it. Everything else is the full read unchanged.
function expectedWithout(
  full: LayoutDocument,
  surface: LayoutDocumentSurface,
): Record<string, unknown> {
  const pages =
    surface === "structure"
      ? mapItems(full.pages, (items) =>
          items.map((item) => withoutField(item, "structure")),
        )
      : surface === "layers"
        ? mapItems(full.pages, (items) =>
            items.map((item) => withoutField(item, "layer")),
          )
        : surface === "destinations"
          ? mapItems(full.pages, (items) =>
              items.filter((item) => item.kind !== "internalLink"),
            )
          : full.pages;
  return {
    ...withoutField(full, SURFACE_FIELD[surface]),
    pages,
    ...(surface === "destinations" && full.outline !== undefined
      ? { outline: withoutDestinations(full.outline) }
      : {}),
    skippedSurfaces: [surface],
  };
}

// The destinations table entry a link or outline entry names, or undefined when the document holds none by that name.
function destinationNamed(
  doc: LayoutDocument,
  name: string,
): Record<string, unknown> | undefined {
  const entry = doc.destinations?.find(
    (destination) => destination.name === name,
  );
  return entry === undefined
    ? undefined
    : { pageIndex: entry.pageIndex, target: entry.target };
}

// The rule a skipped outline adds to the per-surface comparison: the reader mints a `destN` name for each direct destination array in the order it meets them, and the outline is read before any page, so leaving it out renumbers the names minted for page links and drops the entries only the outline minted. A document compared under this rule has each internal link's destination name replaced by the entry it resolves to, and its destinations table reduced to the entries some page item names, keyed by what they resolve to rather than by name.
function withLinksByTarget(
  doc: LayoutDocument | Record<string, unknown>,
  source: LayoutDocument,
): Record<string, unknown> {
  const linkedNames = new Set(
    source.pages.flatMap((page) =>
      page.items.flatMap((item) =>
        item.kind === "internalLink" ? [item.destination] : [],
      ),
    ),
  );
  return {
    ...withoutField(doc, "destinations"),
    pages: mapItems(source.pages, (items) =>
      items.map((item) =>
        item.kind === "internalLink"
          ? {
              ...item,
              destination: destinationNamed(source, item.destination),
            }
          : item,
      ),
    ),
    linkedDestinations: (source.destinations ?? [])
      .filter((destination) => linkedNames.has(destination.name))
      .map((destination) => destinationNamed(source, destination.name)),
  };
}

beforeEach(() => {
  vi.mocked(readOutline).mockClear();
  vi.mocked(createDestinationRegistry).mockClear();
  vi.mocked(readAcroForm).mockClear();
  vi.mocked(readOptionalContent).mockClear();
  vi.mocked(readStructure).mockClear();
});

describe("readPdf surfaces: the fixture carries every surface and every dependency", () => {
  it("reads all six surfaces and every page-item dependency on a full read, and springs every trap", () => {
    const { doc, diagnostics } = readWith(undefined);
    for (const surface of SURFACES) {
      expect(doc[SURFACE_FIELD[surface]]).toBeDefined();
    }
    const items = doc.pages[0]?.items ?? [];
    expect(items.some((item) => "structure" in item)).toBe(true);
    expect(items.some((item) => "layer" in item)).toBe(true);
    expect(items.filter((item) => item.kind === "internalLink")).toHaveLength(
      2,
    );
    expect(items.filter((item) => item.kind === "link")).toHaveLength(1);
    expect(doc.outline?.[0]?.destination).toBe("second");
    expect(doc.source?.["page-boxes"]).toBeDefined();
    expect(doc.skippedSurfaces).toBeUndefined();
    expect(trapsReported(diagnostics)).toEqual(
      Object.values(DOCUMENT_SURFACE_TRAP_OBJECTS).sort((a, b) => a - b),
    );
  });
});

describe("readPdf surfaces: a skipped surface is never parsed", () => {
  it.each(
    SURFACES.filter(
      (surface): surface is ReaderSurface => surface !== "residue",
    ),
  )(
    "never enters the %s reader when it is skipped, and does enter it otherwise",
    (surface) => {
      const reader = SURFACE_READERS[surface]();
      readWith(only(surface));
      expect(reader).not.toHaveBeenCalled();
      for (const other of SURFACES) {
        if (other !== surface && other !== "residue") {
          expect(SURFACE_READERS[other]()).toHaveBeenCalledTimes(1);
        }
      }
    },
  );

  it.each(SURFACES)(
    "reports no diagnostic from the %s trap when that surface is skipped, while every other trap still springs",
    (surface) => {
      const { diagnostics } = readWith(only(surface));
      const trap = DOCUMENT_SURFACE_TRAP_OBJECTS[surface];
      expect(trapsReported(diagnostics)).toEqual(
        Object.values(DOCUMENT_SURFACE_TRAP_OBJECTS)
          .filter((num) => num !== trap)
          .sort((a, b) => a - b),
      );
    },
  );

  it("reports no diagnostic at all when every surface is skipped, and enters no surface reader", () => {
    const { diagnostics } = readWith(NONE);
    expect(diagnostics).toEqual([]);
    for (const reader of Object.values(SURFACE_READERS)) {
      expect(reader()).not.toHaveBeenCalled();
    }
  });
});

describe("readPdf surfaces: what a skipped surface's result holds", () => {
  it.each(SURFACES)(
    "with %s skipped, equals the full read minus that field and what depended on it, naming it in skippedSurfaces",
    (surface) => {
      const full = readWith(undefined).doc;
      const skipped = readWith(only(surface)).doc;
      if (surface === "outline") {
        // A skipped outline also renumbers minted destination names (see withLinksByTarget), so links are compared by the entry they resolve to.
        expect(withLinksByTarget(skipped, skipped)).toEqual(
          withLinksByTarget(expectedWithout(full, surface), full),
        );
        return;
      }
      expect(skipped).toEqual(expectedWithout(full, surface));
    },
  );

  it("renumbers the destN names minted for page links when the outline is skipped, and drops the entries only the outline minted", () => {
    const full = readWith(undefined).doc;
    const skipped = readWith(only("outline")).doc;
    const directLinkOf = (doc: LayoutDocument): string | undefined =>
      doc.pages[0]?.items.flatMap((item) =>
        item.kind === "internalLink" && item.destination !== "second"
          ? [item.destination]
          : [],
      )[0];
    expect(full.outline?.[1]?.destination).toBe("dest1");
    expect(directLinkOf(full)).toBe("dest2");
    expect(directLinkOf(skipped)).toBe("dest1");
    expect(destinationNamed(skipped, "dest1")).toEqual(
      destinationNamed(full, "dest2"),
    );
    expect(destinationNamed(skipped, "dest2")).toBeUndefined();
    expect(
      skipped.destinations?.filter((d) => !/^dest\d+$/u.test(d.name)),
    ).toEqual(full.destinations?.filter((d) => !/^dest\d+$/u.test(d.name)));
  });

  it("omits a skipped surface's field rather than leaving it present and empty", () => {
    const { doc } = readWith(NONE);
    for (const surface of SURFACES) {
      expect(Object.hasOwn(doc, SURFACE_FIELD[surface])).toBe(false);
    }
  });

  it("lists every skipped surface in schema order, however the setting was spelled", () => {
    expect(
      readWith({ residue: false, outline: false, layers: false }).doc
        .skippedSurfaces,
    ).toEqual(["outline", "layers", "residue"]);
    expect(readWith(NONE).doc.skippedSurfaces).toEqual([...SURFACES]);
  });

  it("reads a surface whose entry is true or absent, exactly as a read without the setting", () => {
    const full = readWith(undefined).doc;
    expect(readWith({}).doc).toEqual(full);
    expect(
      readWith(Object.fromEntries(SURFACES.map((s) => [s, true]))).doc,
    ).toEqual(full);
  });

  it("validates against LayoutDocumentSchema, which refuses an empty skippedSurfaces", () => {
    const { doc } = readWith(NONE);
    expect(LayoutDocumentSchema.parse(doc)).toEqual(doc);
    expect(
      LayoutDocumentSchema.safeParse({ ...doc, skippedSurfaces: [] }).success,
    ).toBe(false);
  });
});

describe("readPdf surfaces: independent of pages", () => {
  it("skips surfaces on a page-selected read too, its selected pages losing what the same rules say", () => {
    const fullSelected = readWith(undefined, [0]).doc;
    const selected = readWith(
      { structure: false, destinations: false },
      [0],
    ).doc;
    expect(selected.pages).toEqual(
      mapItems(fullSelected.pages, (items) =>
        items
          .filter((item) => item.kind !== "internalLink")
          .map((item) => withoutField(item, "structure")),
      ),
    );
    expect(selected.pageCount).toBe(fullSelected.pageCount);
    expect(selected.skippedSurfaces).toEqual(["destinations", "structure"]);
  });

  it("reads nothing beyond the page tree and metadata for an empty selection with every surface skipped", () => {
    const { doc, diagnostics } = readWith(NONE, []);
    expect(diagnostics).toEqual([]);
    expect(doc).toEqual({
      formatVersion: readWith(undefined).doc.formatVersion,
      metadata: readWith(undefined).doc.metadata,
      pages: [],
      pageCount: 2,
      images: {},
      skippedSurfaces: [...SURFACES],
    });
  });
});

describe("writePdf refuses a read that skipped a surface", () => {
  it.each(SURFACES)(
    "throws PdfSkippedSurfacesError naming %s, and still writes the full read",
    (surface) => {
      const skipped = readWith(only(surface)).doc;
      expect(() => writePdf(skipped)).toThrow(PdfSkippedSurfacesError);
      expect(() => writePdf(skipped)).toThrow(
        expect.objectContaining({ skippedSurfaces: [surface] }),
      );
      expect(() => writePdf(skipped)).toThrow(surface);
    },
  );

  it("writes a full read", () => {
    expect(writePdf(readWith(undefined).doc).length).toBeGreaterThan(0);
  });

  it("reports the page selection first when a read both selected pages and skipped surfaces", () => {
    expect(() => writePdf(readWith(NONE, [0]).doc)).toThrow(
      PdfPartialDocumentError,
    );
  });
});
