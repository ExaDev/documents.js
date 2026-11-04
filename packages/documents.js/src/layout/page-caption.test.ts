import { describe, expect, it } from "vitest";
import type { LayoutItem } from "pdf-codec";
import { readPageCaption } from "./page-caption";

/** A page of positioned text runs -- every field the layout type requires but this test doesn't vary is filled with a fixed value. */
function page(
  items: { text: string; xPt: number; yPt: number; sizePt: number }[],
): { items: LayoutItem[] } {
  return {
    items: items.map(({ text, xPt, yPt, sizePt }) => ({
      kind: "text" as const,
      text,
      xPt,
      yPt,
      sizePt,
      font: {
        family: "Helvetica",
        weight: "normal" as const,
        style: "normal" as const,
      },
      color: { r: 0, g: 0, b: 0 },
    })),
  };
}

/** A run of body text at the size the page is mostly set in, so the modal size is unambiguous. */
function body(
  count: number,
  sizePt = 7,
): {
  text: string;
  xPt: number;
  yPt: number;
  sizePt: number;
}[] {
  return Array.from({ length: count }, (_, index) => ({
    text: `value ${String(index)}`,
    xPt: 54 + (index % 8) * 40,
    yPt: 600 - Math.floor(index / 8) * 10,
    sizePt,
  }));
}

describe("readPageCaption", () => {
  it("reads the heading a page sets larger than its own body text", () => {
    expect(
      readPageCaption(
        page([
          ...body(40),
          { text: "SPEL Puraceptor", xPt: 80, yPt: 747, sizePt: 18 },
          {
            text: " Class 1 Full Retention Separators",
            xPt: 220,
            yPt: 747,
            sizePt: 18,
          },
          { text: "Single Chamber", xPt: 80, yPt: 729, sizePt: 12 },
        ]),
      ),
    ).toBe("SPEL Puraceptor Class 1 Full Retention Separators Single Chamber");
  });

  it("leaves out the running header, which sits above the heading but is set in the body size", () => {
    // Position alone cannot tell these apart: the running header is the TOPMOST text on the page.
    const caption = readPageCaption(
      page([
        ...body(40),
        { text: "SPEL Products Data Manual", xPt: 347, yPt: 803, sizePt: 7 },
        {
          text: "SPEL Oil Separators & Grease Separators",
          xPt: 434,
          yPt: 803,
          sizePt: 7,
        },
        { text: "Puraceptor Range", xPt: 80, yPt: 747, sizePt: 18 },
      ]),
    );

    expect(caption).toBe("Puraceptor Range");
  });

  it("reads a heading set across two lines down the page, then left to right", () => {
    expect(
      readPageCaption(
        page([
          ...body(40),
          { text: "second", xPt: 120, yPt: 700, sizePt: 20 },
          { text: "line", xPt: 200, yPt: 700, sizePt: 20 },
          { text: "first", xPt: 80, yPt: 740, sizePt: 20 },
        ]),
      ),
    ).toBe("first second line");
  });

  it("ignores a run carrying no letter, however large it is set", () => {
    expect(
      readPageCaption(
        page([
          ...body(40),
          { text: "®", xPt: 215, yPt: 753, sizePt: 24 },
          { text: "3.12", xPt: 9, yPt: 760, sizePt: 24 },
          { text: "Separators", xPt: 80, yPt: 747, sizePt: 18 },
        ]),
      ),
    ).toBe("Separators");
  });

  it("reports no caption for a page set entirely in one size, which carries no heading to read", () => {
    expect(readPageCaption(page(body(40)))).toBeUndefined();
  });

  it("reports no caption for a page with no text at all", () => {
    expect(readPageCaption({ items: [] })).toBeUndefined();
  });

  it("does not mistake a table's own header row, a half point above its figures, for a heading", () => {
    expect(
      readPageCaption(
        page([
          ...body(40, 6.5),
          { text: "Model", xPt: 54, yPt: 700, sizePt: 7 },
          { text: "Flow", xPt: 150, yPt: 700, sizePt: 7 },
        ]),
      ),
    ).toBeUndefined();
  });

  it("truncates a caption long enough to be reproducing the page rather than identifying the table", () => {
    const caption = readPageCaption(
      page([
        ...body(80),
        { text: "x".repeat(400), xPt: 54, yPt: 740, sizePt: 18 },
      ]),
    );

    expect(caption).toHaveLength(203);
    expect(caption?.endsWith("...")).toBe(true);
  });

  it("counts a heading set at exactly half again the body size", () => {
    expect(
      readPageCaption(
        page([
          ...body(40, 7),
          { text: "Technical data", xPt: 54, yPt: 740, sizePt: 10.5 },
        ]),
      ),
    ).toBe("Technical data");
  });

  it("buckets sizes to the half point, so runs a PDF writer set a hair apart still read as one body size", () => {
    // 7.2pt and 6.8pt are both the 7pt body; bucketed any coarser, the heading below would no longer
    // clear half again the body.
    expect(
      readPageCaption(
        page([
          ...body(30, 7.2),
          ...body(10, 6.8),
          { text: "Discharge data", xPt: 54, yPt: 740, sizePt: 10.5 },
        ]),
      ),
    ).toBe("Discharge data");
  });

  it("takes the smaller of two sizes with equally many characters as the body, whichever the page states first", () => {
    expect(
      readPageCaption(
        page([
          { text: "Range", xPt: 54, yPt: 740, sizePt: 12 },
          { text: "overview", xPt: 120, yPt: 740, sizePt: 12 },
          { text: "values", xPt: 54, yPt: 600, sizePt: 7 },
          { text: "figures", xPt: 120, yPt: 600, sizePt: 7 },
        ]),
      ),
    ).toBe("Range overview");
  });

  // novus-power/hive#2566: a slide labels every tick of a chart as its own tiny run, so by run count the page is mostly 5pt text and its 12pt body text reads as a heading.
  describe("a slide with a chart", () => {
    const ticks = Array.from({ length: 38 }, (_, index) => ({
      text: String(index),
      xPt: 120 + (index % 2) * 180,
      yPt: 150 + Math.floor(index / 2) * 12,
      sizePt: 5,
    }));
    const paragraph = [
      "The harmonics add to the rms and peak value of the waveform",
      "This could mean that equipment could receive a damagingly high peak voltage",
      "and could therefore be susceptible to failure",
    ].map((text, index) => ({
      text,
      xPt: 156,
      yPt: 640 - index * 18,
      sizePt: 12,
    }));

    it("reads the slide's title, not the paragraph set in the body size", () => {
      expect(
        readPageCaption(
          page([
            ...ticks,
            ...paragraph,
            {
              text: "The effects of harmonics",
              xPt: 145,
              yPt: 690,
              sizePt: 24,
            },
          ]),
        ),
      ).toBe("The effects of harmonics");
    });

    it("reports no caption when nothing on the slide is set above its body text", () => {
      expect(readPageCaption(page([...ticks, ...paragraph]))).toBeUndefined();
    });
  });

  it("reads only text runs, however many images the page carries", () => {
    const image = (index: number) => ({
      kind: "image" as const,
      imageId: `img-${String(index)}`,
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
    });
    const text = page([
      { text: "Heading", xPt: 54, yPt: 740, sizePt: 18 },
      { text: "body text set small", xPt: 54, yPt: 600, sizePt: 7 },
    ]);

    expect(
      readPageCaption({
        items: [image(1), image(2), image(3), ...text.items],
      }),
    ).toBe("Heading");
  });

  it("reports no caption for text set at no size at all, rather than calling all of it a heading", () => {
    expect(
      readPageCaption(
        page([
          { text: "invisible", xPt: 54, yPt: 740, sizePt: 0 },
          { text: "layer", xPt: 54, yPt: 700, sizePt: 0 },
        ]),
      ),
    ).toBeUndefined();
  });

  it("reads runs on one line left to right, even when the writer emitted the right-hand one first and a little higher", () => {
    expect(
      readPageCaption(
        page([
          ...body(40),
          { text: "Separators", xPt: 200, yPt: 750, sizePt: 18 },
          { text: "Puraceptor", xPt: 80, yPt: 747, sizePt: 18 },
        ]),
      ),
    ).toBe("Puraceptor Separators");
  });

  it("collapses the spacing inside a run", () => {
    expect(
      readPageCaption(
        page([
          ...body(40),
          { text: "Full   Retention", xPt: 80, yPt: 747, sizePt: 18 },
        ]),
      ),
    ).toBe("Full Retention");
  });

  it("keeps a caption of exactly the longest allowed length whole", () => {
    const caption = readPageCaption(
      page([
        ...body(40),
        { text: "x".repeat(200), xPt: 54, yPt: 740, sizePt: 18 },
      ]),
    );

    expect(caption).toBe("x".repeat(200));
  });

  it("trims the trailing space off a truncated caption before marking it truncated", () => {
    const caption = readPageCaption(
      page([
        ...body(40),
        {
          text: `${"x".repeat(199)} ${"y".repeat(50)}`,
          xPt: 54,
          yPt: 740,
          sizePt: 18,
        },
      ]),
    );

    expect(caption).toBe(`${"x".repeat(199)}...`);
  });
});
