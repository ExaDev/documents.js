import type {
  ContentBlock,
  ContentParagraph,
  ContentSection,
  ContentTable,
} from "document-schema.js";
import { readRtfContent } from "../read";
import { bytes } from "./bytes";

// The header prefix every body fixture in the read.test.ts split shares, so each test states only the construct it is about. It is the shape a real producer emits: version, character set, font table, colour table.
export const HEADER =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0" +
  "{\\fonttbl{\\f0\\froman\\fcharset0 Times New Roman;}{\\f1\\fswiss\\fcharset0 Arial;}}" +
  "{\\colortbl;\\red0\\green0\\blue0;\\red255\\green0\\blue0;}";

export function sectionsOf(source: string): ContentSection[] {
  const { document } = readRtfContent(bytes(source));
  if (document.kind !== "wordprocessing") {
    throw new Error(`expected a wordprocessing document, got ${document.kind}`);
  }
  return document.sections;
}

export function blocksOf(source: string): ContentBlock[] {
  return sectionsOf(source).flatMap((section) => section.blocks);
}

export function paragraphsOf(source: string): ContentParagraph[] {
  return blocksOf(source).filter(
    (block): block is ContentParagraph => block.kind === "paragraph",
  );
}

export function firstTable(source: string): ContentTable {
  const table = blocksOf(source).find(
    (block): block is ContentTable => block.kind === "table",
  );
  if (table === undefined) {
    throw new Error("expected the document to contain a table");
  }
  return table;
}
