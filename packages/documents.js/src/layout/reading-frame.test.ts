import { describe, expect, it } from "vitest";
import type { ContentBlock, LayoutFrame } from "document-schema.js";
import { readPdf } from "pdf-codec";
import type {
  LayoutDocument,
  LayoutFormField,
  LayoutImage,
  LayoutPage,
  LayoutText,
} from "pdf-codec";
import { fullyRuledTwoLineHeaderTablePdf } from "../test-support/pdf";
import { pageReadingFrame, restoreSourceFrames } from "./reading-frame";
import {
  reconstructSpreadsheet,
  reconstructWordprocessing,
} from "./reconstruct";

// A page whose text is mostly set a quarter turn from upright is read in the frame that turn makes upright (ExaDev/documents.js#1715). The fixture pair is one table set two ways: on a page carrying /Rotate 90, which pdf-codec already reports as displayed, and on a portrait page with no /Rotate whose every run reads upward, the way a landscape table is typeset in a portrait document. Read in its reading frame the second must give exactly what the first gives, and every frame it stamps must name the same region of its own, portrait, page.

// The fixture's media box: A4 portrait, the page the sideways-text table is set on.
const MEDIA_WIDTH_PT = 595;
const MEDIA_HEIGHT_PT = 842;

function text(
  value: string,
  xPt: number,
  yPt: number,
  rotationDeg?: number,
): LayoutText {
  return {
    kind: "text",
    text: value,
    xPt,
    yPt,
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
    widthPt: 6 * value.length,
    ...(rotationDeg === undefined ? {} : { rotationDeg }),
  };
}

function singlePageDoc(
  page: LayoutPage,
  extra: Partial<Pick<LayoutDocument, "images" | "form">> = {},
): LayoutDocument {
  return {
    formatVersion: 1,
    metadata: {},
    pages: [page],
    images: extra.images ?? {},
    ...(extra.form === undefined ? {} : { form: extra.form }),
  };
}

// Every frame under `content`, in document order.
function framesIn(content: unknown): LayoutFrame[] {
  if (typeof content !== "object" || content === null) {
    return [];
  }
  const own =
    "frames" in content && Array.isArray(content.frames)
      ? content.frames.filter(
          (frame: unknown): frame is LayoutFrame =>
            typeof frame === "object" && frame !== null && "xPt" in frame,
        )
      : [];
  return [
    ...own,
    ...Object.entries(content)
      .filter(([key]) => key !== "frames")
      .flatMap(([, child]) => framesIn(child)),
  ];
}

// A region of the displayed (turned) page as it lies on the portrait page it was turned from: displayed (X, Y) is unrotated (W - Y, X).
function onPortraitPage(frame: LayoutFrame): LayoutFrame {
  return {
    pageIndex: frame.pageIndex,
    xPt: MEDIA_WIDTH_PT - frame.yPt - frame.heightPt,
    yPt: frame.xPt,
    widthPt: frame.heightPt,
    heightPt: frame.widthPt,
  };
}

function expectFramesClose(
  actual: readonly LayoutFrame[],
  expected: readonly LayoutFrame[],
): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((frame, index) => {
    const want = expected[index]!;
    expect(frame.pageIndex).toBe(want.pageIndex);
    expect(frame.xPt).toBeCloseTo(want.xPt, 6);
    expect(frame.yPt).toBeCloseTo(want.yPt, 6);
    expect(frame.widthPt).toBeCloseTo(want.widthPt, 6);
    expect(frame.heightPt).toBeCloseTo(want.heightPt, 6);
  });
}

describe("pageReadingFrame", () => {
  it("turns a portrait page whose text reads upward into the landscape page a reader sees, every item where the displayed page has it", () => {
    const displayed = readPdf(fullyRuledTwoLineHeaderTablePdf("sideways"))
      .pages[0]!;
    const turned = pageReadingFrame(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways-text")).pages[0]!,
    );
    expect(turned?.turnDeg).toBe(90);
    expect(turned?.page.widthPt).toBe(MEDIA_HEIGHT_PT);
    expect(turned?.page.heightPt).toBe(MEDIA_WIDTH_PT);
    expect(turned?.page.items).toEqual(displayed.items);
  });

  it("leaves an upright page as it stands", () => {
    expect(
      pageReadingFrame(
        readPdf(fullyRuledTwoLineHeaderTablePdf("upright")).pages[0]!,
      ),
    ).toBeUndefined();
  });

  it("turns a page whose text reads upside down by a half turn", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [text("ab", 60, 150, 180)],
    };
    const turned = pageReadingFrame(page);
    expect(turned?.turnDeg).toBe(180);
    expect([turned?.page.widthPt, turned?.page.heightPt]).toEqual([100, 200]);
    expect(turned?.page.items).toEqual([text("ab", 40, 50)]);
  });

  it("turns a page whose text reads downward, which pdf-codec reports as a negative quarter turn", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [text("ab", 60, 150, -90)],
    };
    const turned = pageReadingFrame(page);
    expect(turned?.turnDeg).toBe(270);
    expect([turned?.page.widthPt, turned?.page.heightPt]).toEqual([200, 100]);
    expect(turned?.page.items).toEqual([text("ab", 50, 60)]);
  });

  it("keeps an upright run on a turned page turned the other way, as it reads once the page is turned", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [text("sideways", 60, 20, 90), text("7", 50, 10)],
    };
    const folio = pageReadingFrame(page)?.page.items[1];
    expect(folio).toMatchObject({ text: "7", rotationDeg: -90 });
  });

  it("reads a page as it stands when its turned text is exactly half of its characters", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [text("abcd", 10, 10), text("efgh", 60, 20, 90)],
    };
    expect(pageReadingFrame(page)).toBeUndefined();
  });

  it("turns a page when its turned text is more than half of its non-blank characters", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [
        text("abc", 10, 10),
        text("   ", 10, 30),
        text("efgh", 60, 20, 90),
      ],
    };
    expect(pageReadingFrame(page)?.turnDeg).toBe(90);
  });

  it("counts no angle short of a quarter turn as one", () => {
    const page: LayoutPage = {
      widthPt: 100,
      heightPt: 200,
      items: [text("efgh", 60, 20, 89.9)],
    };
    expect(pageReadingFrame(page)).toBeUndefined();
  });

  it("maps a box on the turned page back onto the region of the source page it covers", () => {
    const turned = pageReadingFrame({
      widthPt: 100,
      heightPt: 200,
      items: [text("ab", 60, 150, 90)],
    });
    // On the turned page (200 wide, 100 high) the box spans x 10 to 40 and y 20 to 30; turned back a quarter turn anticlockwise it spans x 70 to 80 and y 10 to 40.
    expect(
      turned?.toSource({ xPt: 10, yPt: 20, widthPt: 30, heightPt: 10 }),
    ).toEqual({ xPt: 70, yPt: 10, widthPt: 10, heightPt: 30 });
  });
});

describe("restoreSourceFrames", () => {
  it("maps every frame on the page however deeply it is nested, and no frame on another page", () => {
    const toSource = (box: {
      xPt: number;
      yPt: number;
      widthPt: number;
      heightPt: number;
    }) => ({ ...box, xPt: box.xPt + 100 });
    const onPage = { pageIndex: 2, xPt: 1, yPt: 2, widthPt: 3, heightPt: 4 };
    const otherPage = { ...onPage, pageIndex: 3 };
    const content = {
      frames: [onPage, otherPage],
      rows: [{ cells: [{ frames: [onPage] }] }],
    };
    restoreSourceFrames(content, 2, toSource);
    expect(content).toEqual({
      frames: [{ ...onPage, xPt: 101 }, otherPage],
      rows: [{ cells: [{ frames: [{ ...onPage, xPt: 101 }] }] }],
    });
  });
});

describe("reconstructing a page set sideways with no /Rotate", () => {
  it("gives the content the displayed page gives, every frame naming the same region of the portrait page", () => {
    const displayed = reconstructWordprocessing(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways")),
    );
    const sideways = reconstructWordprocessing(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways-text")),
    );
    const withoutFramesOrPageSize = (content: unknown): unknown =>
      JSON.parse(
        JSON.stringify(content, (key, value: unknown) =>
          key === "frames" || key === "pageSize" ? undefined : value,
        ),
      );
    expect(withoutFramesOrPageSize(sideways)).toEqual(
      withoutFramesOrPageSize(displayed),
    );
    expectFramesClose(
      framesIn(sideways),
      framesIn(displayed).map(onPortraitPage),
    );
  });

  it("keeps the section on the page's own size", () => {
    const content = reconstructWordprocessing(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways-text")),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    expect(content.sections[0]?.pageSize).toEqual({
      widthPt: MEDIA_WIDTH_PT,
      heightPt: MEDIA_HEIGHT_PT,
    });
  });

  it("reads the table into the sheet the displayed page gives, its cells framed on the portrait page and its print size the page's own", () => {
    const displayed = reconstructSpreadsheet(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways")),
    );
    const sideways = reconstructSpreadsheet(
      readPdf(fullyRuledTwoLineHeaderTablePdf("sideways-text")),
    );
    if (displayed.kind !== "spreadsheet" || sideways.kind !== "spreadsheet") {
      throw new Error("expected spreadsheet content");
    }
    const cellValues = (cells: (typeof sideways.sheets)[number]["cells"]) =>
      cells.map((cell) => [cell.row, cell.column, cell.value]);
    expect(cellValues(sideways.sheets[0]!.cells)).toEqual(
      cellValues(displayed.sheets[0]!.cells),
    );
    expectFramesClose(
      framesIn(sideways.sheets[0]!.cells),
      framesIn(displayed.sheets[0]!.cells).map(onPortraitPage),
    );
    expect(sideways.sheets[0]?.printSettings.pageSize).toEqual({
      widthPt: MEDIA_WIDTH_PT,
      heightPt: MEDIA_HEIGHT_PT,
    });
  });

  it("anchors a form field stated on the portrait page to the block it covers there", () => {
    // Two lines read upward, 100pt apart across the page: "Upper" nearer the page's left edge reads above "Lower" once the page is turned. The widget covers where "Lower" lies on the portrait page.
    const page: LayoutPage = {
      widthPt: 300,
      heightPt: 400,
      items: [text("Upper", 100, 50, 90), text("Lower", 200, 50, 90)],
    };
    const form: LayoutFormField[] = [
      {
        name: "f",
        fieldType: "text",
        widgets: [
          { pageIndex: 0, xPt: 190, yPt: 45, widthPt: 20, heightPt: 40 },
        ],
        children: [],
      },
    ];
    const content = reconstructWordprocessing(singlePageDoc(page, { form }));
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const blocks: ContentBlock[] = content.sections[0]!.blocks;
    const start = blocks.findIndex((block) => block.kind === "constructStart");
    expect(blocks[start + 1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "Lower" }],
    });
    expect(blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
  });
});

describe("an image's frame on a page read in its reading frame", () => {
  const asset = {
    format: "png" as const,
    base64: "",
    widthPx: 1,
    heightPx: 1,
  };

  function imageFrame(page: LayoutPage): LayoutFrame[] | undefined {
    const content = reconstructWordprocessing(
      singlePageDoc(page, { images: { img: asset } }),
    );
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    return content.sections[0]!.blocks.find((block) => block.kind === "image")
      ?.frames;
  }

  it("is an upright image's own box on a page read in its reading frame", () => {
    const image: LayoutImage = {
      kind: "image",
      imageId: "img",
      xPt: 20,
      yPt: 300,
      widthPt: 40,
      heightPt: 30,
    };
    expectFramesClose(
      imageFrame({
        widthPt: 300,
        heightPt: 400,
        items: [text("sideways", 100, 50, 90), image],
      }) ?? [],
      [{ pageIndex: 0, xPt: 20, yPt: 300, widthPt: 40, heightPt: 30 }],
    );
  });
});

describe("reading order within a sideways page", () => {
  it("reads the printed rows top to bottom with their cells in reading order", () => {
    const page: LayoutPage = {
      widthPt: MEDIA_WIDTH_PT,
      heightPt: MEDIA_HEIGHT_PT,
      // Two printed rows read upward; the first (nearer the page's left edge) is the upper row once the page is turned.
      items: [
        text("16", 100, 300, 90),
        text("44", 100, 340, 90),
        text("41", 100, 380, 90),
        text("25", 120, 300, 90),
        text("57", 120, 340, 90),
        text("52", 120, 380, 90),
      ],
    };
    const content = reconstructWordprocessing(singlePageDoc(page));
    if (content.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing content");
    }
    const lines = content.sections[0]!.blocks.flatMap((block) =>
      block.kind === "paragraph"
        ? [block.runs.map((run) => run.text).join("")]
        : [],
    );
    expect(lines).toEqual(["16\t44\t41", "25\t57\t52"]);
  });
});
