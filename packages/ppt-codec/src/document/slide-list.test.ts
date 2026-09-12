import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import {
  RT_Notes,
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextBytesAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import {
  asciiBytes,
  concatBytes,
  i32le,
  u32le,
  writeAtom as atom,
  writeContainer as container,
} from "../record/write";
import { TEXT_TYPE_BODY, TEXT_TYPE_TITLE } from "../text/atoms";
import { readSlideListWithText } from "./slide-list";

function slidePersistAtom(
  persistIdRef: number,
  slideId: number,
): Uint8Array<ArrayBuffer> {
  return atom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persistIdRef),
      u32le(0),
      i32le(0),
      u32le(slideId),
      u32le(0),
    ),
  );
}

function textHeaderAtom(textType: number): Uint8Array<ArrayBuffer> {
  return atom(RT_TextHeaderAtom, u32le(textType));
}

function textBytesAtom(text: string): Uint8Array<ArrayBuffer> {
  return atom(RT_TextBytesAtom, asciiBytes(text));
}

describe("readSlideListWithText", () => {
  it("reads a slide's own persistIdRef and slideId", () => {
    const bytes = container(RT_SlideListWithText, [slidePersistAtom(3, 256)]);
    const [slide] = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slide).toMatchObject({ persistIdRef: 3, slideId: 256 });
  });

  it("attributes a text and every record after it to that text, until the next opener", () => {
    const bytes = container(RT_SlideListWithText, [
      slidePersistAtom(3, 256),
      textHeaderAtom(TEXT_TYPE_TITLE),
      textBytesAtom("Title text"),
      textHeaderAtom(TEXT_TYPE_BODY),
      textBytesAtom("Body text"),
    ]);
    const [slide] = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slide?.texts).toHaveLength(2);
    expect(slide?.texts[0]?.textType).toBe(TEXT_TYPE_TITLE);
    expect(slide?.texts[0]?.records).toHaveLength(1);
    expect(slide?.texts[1]?.textType).toBe(TEXT_TYPE_BODY);
    expect(slide?.texts[1]?.records).toHaveLength(1);
  });

  it("reads several slides, each with its own persistIdRef/slideId and text list", () => {
    const bytes = container(RT_SlideListWithText, [
      slidePersistAtom(3, 256),
      textHeaderAtom(TEXT_TYPE_TITLE),
      slidePersistAtom(4, 257),
      textHeaderAtom(TEXT_TYPE_BODY),
    ]);
    const slides = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slides.map((s) => s.slideId)).toEqual([256, 257]);
    expect(slides[0]?.texts.map((t) => t.textType)).toEqual([TEXT_TYPE_TITLE]);
    expect(slides[1]?.texts.map((t) => t.textType)).toEqual([TEXT_TYPE_BODY]);
  });

  it("reads a slide with no texts at all as an empty texts array", () => {
    const bytes = container(RT_SlideListWithText, [slidePersistAtom(3, 256)]);
    const [slide] = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slide?.texts).toEqual([]);
  });

  it("ignores a stray record before any SlidePersistAtom rather than crashing", () => {
    const bytes = container(RT_SlideListWithText, [
      atom(RT_TextBytesAtom, asciiBytes("orphaned")),
      slidePersistAtom(3, 256),
    ]);
    const [slide] = readSlideListWithText(readRecordAt(bytes, 0));
    expect(slide).toMatchObject({ persistIdRef: 3, slideId: 256, texts: [] });
  });

  it("rejects a container whose type is not RT_SlideListWithText", () => {
    const bytes = container(RT_Notes, []);
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      `expected RT_SlideListWithText (0x${RT_SlideListWithText.toString(16)}), found record type 0x${RT_Notes.toString(16)}`,
    );
  });

  it("rejects a SlidePersistAtom shorter than the mandated 0x14 bytes", () => {
    const bytes = container(RT_SlideListWithText, [
      atom(RT_SlidePersistAtom, asciiBytes("short")),
    ]);
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      "carries 5 bytes, fewer than the mandated 0x14",
    );
  });

  it("rejects a TextHeaderAtom preceding any SlidePersistAtom", () => {
    const bytes = container(RT_SlideListWithText, [
      textHeaderAtom(TEXT_TYPE_TITLE),
    ]);
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      PptFormatError,
    );
    expect(() => readSlideListWithText(readRecordAt(bytes, 0))).toThrow(
      "precedes any SlidePersistAtom, so it belongs to no slide",
    );
  });
});
