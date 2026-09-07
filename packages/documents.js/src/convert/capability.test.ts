import { describe, expect, it } from "vitest";
import { FORMAT_CAPABILITIES } from "./capability";
import { resolveCompositionPlan } from "./composition";
import type { DocumentFormat } from "./port";

describe("FORMAT_CAPABILITIES", () => {
  it("groups every format by its real ContentDocument-variant compatibility", () => {
    const byVariant = new Map<string, DocumentFormat[]>();
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      if (capability.variant === undefined) {
        continue;
      }
      const formats = byVariant.get(capability.variant) ?? [];
      formats.push(capability.format);
      byVariant.set(capability.variant, formats);
    }

    expect(new Set(byVariant.get("wordprocessing"))).toEqual(
      new Set(["docx", "odt", "markdown", "rtf", "doc", "wpd"]),
    );
    expect(new Set(byVariant.get("presentation"))).toEqual(
      new Set(["pptx", "odp", "ppt"]),
    );
    expect(new Set(byVariant.get("spreadsheet"))).toEqual(
      new Set(["xlsx", "ods", "csv", "xls"]),
    );
    expect(new Set(byVariant.get("drawing"))).toEqual(new Set(["odg", "svg"]));
  });

  it("marks xlsx and csv as the spreadsheet members with no layout path of their own (ods carries the layout edge)", () => {
    expect(FORMAT_CAPABILITIES.xlsx.variant).toBe("spreadsheet");
    expect(FORMAT_CAPABILITIES.xlsx.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.csv.variant).toBe("spreadsheet");
    expect(FORMAT_CAPABILITIES.csv.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.ods.variant).toBe("spreadsheet");
    expect(FORMAT_CAPABILITIES.ods.hasLayoutPath).toBe(true);
  });

  it("marks svg as the drawing family's plain-text member with its own layout path (a sibling of odg, not an ods-style composed member)", () => {
    expect(FORMAT_CAPABILITIES.svg.variant).toBe("drawing");
    expect(FORMAT_CAPABILITIES.svg.hasLayoutPath).toBe(true);
  });

  it("marks rtf as the wordprocessing family's plain-text member with no layout path of its own (an xlsx/csv-style composed member, not an svg-style one)", () => {
    expect(FORMAT_CAPABILITIES.rtf.variant).toBe("wordprocessing");
    expect(FORMAT_CAPABILITIES.rtf.hasLayoutPath).toBe(false);
  });

  it("marks doc/xls/ppt as read-and-write, layout-less members of their own variant family (the three legacy binary codecs, each xlsx/csv/rtf-style composed)", () => {
    expect(FORMAT_CAPABILITIES.doc.variant).toBe("wordprocessing");
    expect(FORMAT_CAPABILITIES.doc.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.doc.readOnly).toBe(false);
    expect(FORMAT_CAPABILITIES.xls.variant).toBe("spreadsheet");
    expect(FORMAT_CAPABILITIES.xls.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.xls.readOnly).toBe(false);
    expect(FORMAT_CAPABILITIES.ppt.variant).toBe("presentation");
    expect(FORMAT_CAPABILITIES.ppt.hasLayoutPath).toBe(false);
    expect(FORMAT_CAPABILITIES.ppt.readOnly).toBe(false);
  });

  it("has no undefined-variant format other than pdf and odf reporting a layout path", () => {
    for (const capability of Object.values(FORMAT_CAPABILITIES)) {
      if (capability.variant === undefined) {
        expect(capability.hasLayoutPath).toBe(false);
      }
    }
  });
});

describe("resolveCompositionPlan", () => {
  it("routes a same-variant pair as a single bridge hop (never through PDF)", () => {
    // docx -> odt: both wordprocessing, so the pathfinder prefers the cost-1 bridge over any PDF route.
    const plan = resolveCompositionPlan("docx", "odt");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
    expect(plan!.hops[0]!.from).toBe("docx");
    expect(plan!.hops[0]!.to).toBe("odt");
  });

  it("routes a cross-variant transform pair as a single bridge hop (never through PDF)", () => {
    // docx (wordprocessing) -> pptx (presentation): the wordprocessing->presentation transform is registered, so the pathfinder routes it as a cost-2 bridge, beating any PDF route (cost 3 + 3 = 6).
    const plan = resolveCompositionPlan("docx", "pptx");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("routes a toPdf pair as a single toPdf hop", () => {
    const plan = resolveCompositionPlan("docx", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("toPdf");
  });

  it("routes a fromPdf pair as a single fromPdf hop", () => {
    const plan = resolveCompositionPlan("pdf", "docx");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("fromPdf");
  });

  it("composes xlsx -> pdf through ods (bridge then toPdf), since xlsx has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("xlsx", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    expect(plan!.hops[0]!.from).toBe("xlsx");
    expect(plan!.hops[0]!.to).toBe("ods");
    expect(plan!.hops[1]!.from).toBe("ods");
    expect(plan!.hops[1]!.to).toBe("pdf");
  });

  it("composes pdf -> xlsx through ods (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "xlsx");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("composes csv -> pdf through ods (bridge then toPdf), since csv has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("csv", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    expect(plan!.hops[0]!.from).toBe("csv");
    expect(plan!.hops[0]!.to).toBe("ods");
    expect(plan!.hops[1]!.from).toBe("ods");
    expect(plan!.hops[1]!.to).toBe("pdf");
  });

  it("composes pdf -> csv through ods (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "csv");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("routes svg -> pdf as a single toPdf hop, since svg rides the drawing layout engine odg feeds", () => {
    const plan = resolveCompositionPlan("svg", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("toPdf");
    expect(plan!.hops[0]!.from).toBe("svg");
    expect(plan!.hops[0]!.to).toBe("pdf");
  });

  it("routes pdf -> svg as a single fromPdf hop", () => {
    const plan = resolveCompositionPlan("pdf", "svg");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("fromPdf");
    expect(plan!.hops[0]!.from).toBe("pdf");
    expect(plan!.hops[0]!.to).toBe("svg");
  });

  it("routes svg -> odg as a single same-variant bridge hop (the drawing family's plain-text member)", () => {
    const plan = resolveCompositionPlan("svg", "odg");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
    expect(plan!.hops[0]!.from).toBe("svg");
    expect(plan!.hops[0]!.to).toBe("odg");
  });

  it("routes rtf -> docx as a single same-variant bridge hop (never through PDF)", () => {
    // rtf shares the wordprocessing variant with docx/odt/markdown, so the pathfinder prefers the cost-1 bridge over any PDF route, exactly like docx -> odt above.
    const plan = resolveCompositionPlan("rtf", "docx");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
    expect(plan!.hops[0]!.from).toBe("rtf");
    expect(plan!.hops[0]!.to).toBe("docx");
  });

  it("composes rtf -> pdf through docx (bridge then toPdf), since rtf has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("rtf", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    expect(plan!.hops[0]!.from).toBe("rtf");
    expect(plan!.hops[1]!.to).toBe("pdf");
  });

  it("composes pdf -> rtf through docx (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "rtf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
    expect(plan!.hops[1]!.to).toBe("rtf");
  });

  it("returns undefined for rtf -> csv and rtf -> xlsx -- reaching a spreadsheet target from a wordprocessing source is still outside the pathfinder's 3-hop cap", () => {
    // Reaching csv/xlsx from rtf needs a fourth hop (rtf has no toPdf/fromPdf edge of its own): rtf -> {docx|odt|markdown} (bridge) -> pdf (toPdf) -> ods (fromPdf) -> {csv|xlsx} (bridge). That is one hop past resolveCompositionPlan's own cap, so this direction is the one place this format's routing genuinely falls short of full connectivity -- an honest "unsupported", not a wiring gap.
    expect(resolveCompositionPlan("rtf", "csv")).toBeUndefined();
    expect(resolveCompositionPlan("rtf", "xlsx")).toBeUndefined();
  });

  it("resolves csv -> rtf and xlsx -> rtf as a single cross-variant transform hop (the reverse of the pair above, ExaDev/documents.js#1043)", () => {
    // spreadsheetToWordprocessing (variant-bridges.ts) has no reverse, so the pair above stays one-directional: the spreadsheet-sourced direction is a real one-hop bridge, cheaper than the four-hop route the cap was blocking.
    const csvToRtf = resolveCompositionPlan("csv", "rtf");
    expect(csvToRtf).toBeDefined();
    expect(csvToRtf!.hops).toHaveLength(1);
    expect(csvToRtf!.hops[0]!.executor).toBe("bridge");
    const xlsxToRtf = resolveCompositionPlan("xlsx", "rtf");
    expect(xlsxToRtf).toBeDefined();
    expect(xlsxToRtf!.hops).toHaveLength(1);
    expect(xlsxToRtf!.hops[0]!.executor).toBe("bridge");
  });

  it("routes doc -> docx as a single same-variant bridge hop (never through PDF)", () => {
    const plan = resolveCompositionPlan("doc", "docx");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
    expect(plan!.hops[0]!.from).toBe("doc");
    expect(plan!.hops[0]!.to).toBe("docx");
  });

  it("composes doc -> pdf through docx (bridge then toPdf), since doc has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("doc", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
  });

  it("composes pdf -> doc through docx (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "doc");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("routes doc -> ppt as a single cross-variant transform hop (wordprocessing -> presentation, never through PDF)", () => {
    // doc and ppt are each layout-less within their own variant, but the cross-variant TRANSFORMS edge between wordprocessing and presentation costs 2 regardless of hasLayoutPath -- so this is a real one-hop route, cheaper than either format's own PDF composition.
    const plan = resolveCompositionPlan("doc", "ppt");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("returns undefined for doc -> csv, doc -> xlsx, and doc -> xls -- the identical one-hop-too-many gap rtf -> csv/xlsx already has", () => {
    // doc has no toPdf/fromPdf edge of its own (like rtf), so reaching any spreadsheet-variant member needs doc -> {docx|odt|markdown|rtf} (bridge) -> pdf (toPdf) -> ods (fromPdf) -> {csv|xlsx|xls} (bridge): four hops, one past the cap.
    expect(resolveCompositionPlan("doc", "csv")).toBeUndefined();
    expect(resolveCompositionPlan("doc", "xlsx")).toBeUndefined();
    expect(resolveCompositionPlan("doc", "xls")).toBeUndefined();
  });

  it("resolves csv -> doc, xlsx -> doc, and xls -> doc as a single cross-variant transform hop (the reverse of the pair above, ExaDev/documents.js#1043)", () => {
    for (const source of ["csv", "xlsx", "xls"] as const) {
      const plan = resolveCompositionPlan(source, "doc");
      expect(plan, `${source} -> doc`).toBeDefined();
      expect(plan!.hops, `${source} -> doc`).toHaveLength(1);
      expect(plan!.hops[0]!.executor, `${source} -> doc`).toBe("bridge");
    }
  });

  it("routes xls -> ods as a single same-variant bridge hop (never through PDF)", () => {
    const plan = resolveCompositionPlan("xls", "ods");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("composes xls -> pdf through ods (bridge then toPdf), since xls has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("xls", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    expect(plan!.hops[0]!.from).toBe("xls");
    expect(plan!.hops[0]!.to).toBe("ods");
  });

  it("composes pdf -> xls through ods (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "xls");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("resolves xls -> markdown as a single cross-variant transform hop (spreadsheet -> wordprocessing, ExaDev/documents.js#1043) rather than composing through ods and pdf", () => {
    const plan = resolveCompositionPlan("xls", "markdown");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("returns undefined for rtf -> xls -- reaching a spreadsheet target from a layout-less wordprocessing source still needs one hop more than the cap allows", () => {
    expect(resolveCompositionPlan("rtf", "xls")).toBeUndefined();
  });

  it("resolves xls -> rtf as a single cross-variant transform hop (the reverse of the pair above, ExaDev/documents.js#1043)", () => {
    const plan = resolveCompositionPlan("xls", "rtf");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("returns undefined for ppt -> xls -- both endpoints still need their own same-variant bridge hop before pdf, one hop more than the cap allows", () => {
    // ppt -> pptx (bridge) -> pdf (toPdf) -> ods (fromPdf) -> xls (bridge): four hops, since neither ppt nor xls is LAYOUT_CAPABLE on its own.
    expect(resolveCompositionPlan("ppt", "xls")).toBeUndefined();
  });

  it("resolves xls -> ppt as two cross-variant transform hops through a wordprocessing pivot (the reverse of the pair above, ExaDev/documents.js#1043)", () => {
    // xls -> docx (spreadsheet -> wordprocessing, cost 2) -> ppt (wordprocessing -> presentation, cost 2): cost 4, cheaper than the four-hop PDF-composed route the cap was blocking.
    const plan = resolveCompositionPlan("xls", "ppt");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(2);
    expect(plan!.hops.every((h) => h.executor === "bridge")).toBe(true);
  });

  it("routes ppt -> pptx as a single same-variant bridge hop (never through PDF)", () => {
    const plan = resolveCompositionPlan("ppt", "pptx");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("composes ppt -> pdf through pptx (bridge then toPdf), since ppt has no layout engine of its own", () => {
    const plan = resolveCompositionPlan("ppt", "pdf");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["bridge", "toPdf"]);
    expect(plan!.hops[0]!.from).toBe("ppt");
    expect(plan!.hops[0]!.to).toBe("pptx");
  });

  it("composes pdf -> ppt through pptx (fromPdf then bridge)", () => {
    const plan = resolveCompositionPlan("pdf", "ppt");
    expect(plan).toBeDefined();
    expect(plan!.hops.map((h) => h.executor)).toEqual(["fromPdf", "bridge"]);
  });

  it("returns undefined for ppt -> csv and ppt -> xlsx -- the identical too-many-hops gap ppt -> xls already has", () => {
    expect(resolveCompositionPlan("ppt", "csv")).toBeUndefined();
    expect(resolveCompositionPlan("ppt", "xlsx")).toBeUndefined();
  });

  it("resolves csv -> ppt and xlsx -> ppt as two cross-variant transform hops through a wordprocessing pivot (the reverse of the pair above, ExaDev/documents.js#1043)", () => {
    for (const source of ["csv", "xlsx"] as const) {
      const plan = resolveCompositionPlan(source, "ppt");
      expect(plan, `${source} -> ppt`).toBeDefined();
      expect(plan!.hops, `${source} -> ppt`).toHaveLength(2);
      expect(
        plan!.hops.every((h) => h.executor === "bridge"),
        `${source} -> ppt`,
      ).toBe(true);
    }
  });

  it("resolves csv -> markdown and xlsx -> markdown as a single cross-variant transform hop (spreadsheet -> wordprocessing, ExaDev/documents.js#1043) rather than composing through ods and pdf", () => {
    for (const source of ["csv", "xlsx"] as const) {
      const plan = resolveCompositionPlan(source, "markdown");
      expect(plan, `${source} -> markdown`).toBeDefined();
      expect(plan!.hops, `${source} -> markdown`).toHaveLength(1);
      expect(plan!.hops[0]!.executor, `${source} -> markdown`).toBe("bridge");
    }
  });

  it("prefers a native bridge over a PDF route for docx -> odt (cost 1 beats cost 6)", () => {
    // The pathfinder must prefer the direct same-variant bridge (cost 1) over a docx -> pdf -> odt route (cost 3 + 3 = 6).
    const plan = resolveCompositionPlan("docx", "odt");
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("prefers a cross-variant transform bridge over a PDF route for docx -> odp (cost 2 beats cost 6)", () => {
    // docx (wordprocessing) -> odp (presentation): the transform bridge costs 2, the PDF route would cost 6.
    const plan = resolveCompositionPlan("docx", "odp");
    expect(plan).toBeDefined();
    expect(plan!.hops).toHaveLength(1);
    expect(plan!.hops[0]!.executor).toBe("bridge");
  });

  it("returns undefined for same-format pairs", () => {
    for (const format of Object.keys(FORMAT_CAPABILITIES) as DocumentFormat[]) {
      expect(resolveCompositionPlan(format, format)).toBeUndefined();
    }
  });

  it("returns undefined for odf -> pdf (deliberately excluded from the composition engine)", () => {
    // odf is a standalone formula document that renders through src/mathml's own formula-positioning path, not a ContentDocument -> LayoutDocument layout engine. The pathfinder excludes it; local.ts special-cases it with the hand-written odfToPdf.
    expect(resolveCompositionPlan("odf", "pdf")).toBeUndefined();
  });

  it("returns undefined when odf is the target -- nothing in the composition graph routes to it", () => {
    expect(resolveCompositionPlan("pdf", "odf")).toBeUndefined();
    expect(resolveCompositionPlan("docx", "odf")).toBeUndefined();
    expect(resolveCompositionPlan("xlsx", "odf")).toBeUndefined();
  });
});
