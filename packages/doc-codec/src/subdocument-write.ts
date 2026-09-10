import type { ContentDocument } from "document-schema.js";
import type { DataStreamBuilder } from "./data-stream";
import { DocFormatError } from "./errors";
import {
  FIXED_SEPARATOR_STORY_COUNT,
  SLOT_ORDER,
  type HeaderFooterStory,
} from "./headers-footers";
import { PARAGRAPH_MARK } from "./text/special";
import {
  flattenSectionBlocks,
  type WriteParagraph,
  type WriteWarning,
} from "./table/write";

// The inverse of subdocument.ts's readSubdocumentStories: the footnote, header, comment, and endnote subdocuments readDocContent resolves from PlcffndTxt/PlcfHdd/PlcfandTxt/PlcfendTxt, written back as genuine subdocument text plus genuine boundary plexes. Every layout fact here is [MS-DOC]'s own, each confirmed against a real producer's bytes (a LibreOffice-authored .doc) before being implemented rather than derived from the specification alone: a subdocument's stories are concatenated in plex order, each non-empty story's own span ends with its content's final paragraph mark plus the one guard mark [MS-DOC]'s Headers page mandates ("If a story is non-empty, it MUST end with a paragraph mark that serves as a guard between stories. This paragraph mark is not considered part of the story contents"), the subdocument carries exactly one further paragraph mark beyond the last story's end -- which is what makes each plex's own "The second-to-last CP only ends the last story and MUST be equal to FibRgLw97.ccp<subdocument> minus 1" satisfiable at all -- and the last, "undefined and MUST be ignored", CP is written as the subdocument's own length (a value inside that "ignored" contract; the real producer captured for this design wrote ccp+1 there instead, which the reader ignores identically).
//
// What this writer deliberately does NOT write for notes is the reference side: PlcffndRef/PlcfandRef/PlcfendRef and the U+0002/U+0005 reference characters in the main document. The model this writer consumes carries no reference positions -- the reader drops the reference anchors entirely and reads note BODIES keyed by document-order ordinals -- so there is nothing to write references FROM, and a note story written without a reference is honestly unreferenced content rather than a fake live footnote. The header document's six leading separator stories are written as genuine empty stories (zero-width, [MS-DOC]'s own "the story is considered empty" spelling), matching that they are not modelled on either side.

/** One written subdocument: its paragraphs (to be appended after the main document's own, in [MS-DOC]'s own subdocument order), the CP-only plex dividing them into stories, and the ccp the FIB states for it. `undefined` never appears here -- a subdocument with no stories is not written at all (write.ts leaves its ccp and fc/lcb pairs zero, exactly what the reader treats as "absent"). */
export interface StorySubdocument {
  readonly paragraphs: readonly WriteParagraph[];
  readonly plex: Uint8Array<ArrayBuffer>;
  readonly ccp: number;
}

/** A plain one-run text run: no character formatting, no extra grpprl -- a note body's own text carries no modelled formatting to state. */
function textRun(text: string): { run: { text: string }; extraGrpprl: [] } {
  return { run: { text }, extraGrpprl: [] };
}

/** The bare paragraph mark every non-empty story ends with -- no runs, no properties, the "not considered part of the story contents" guard itself. */
function guardParagraph(): WriteParagraph {
  return {
    runs: [],
    properties: {},
    extraGrpprl: [],
    terminator: PARAGRAPH_MARK,
  };
}

/** One paragraph's own character footprint in the text stream: every run's own characters plus the paragraph's own terminator. Exported because write.ts counts the main document's own ccpText with the identical arithmetic -- one source, so the two can never disagree about what a paragraph costs. */
export function paragraphCharacters(paragraph: WriteParagraph): number {
  return (
    1 + paragraph.runs.reduce((count, run) => count + run.run.text.length, 0)
  );
}

/** A CP-only plex (element size 0, [MS-DOC] 2.2.2's own "the data thus has a size of 0 bytes" shape PlcffndTxt/PlcfandTxt/PlcfendTxt/PlcfHdd all share): just the aCP array, one 4-byte little-endian value per key. */
function buildCpOnlyPlex(keys: readonly number[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(keys.length * 4);
  const view = new DataView(bytes.buffer);
  keys.forEach((key, index) => {
    view.setUint32(index * 4, key, true);
  });
  return bytes;
}

// Finishes a subdocument whose stories were already appended: adds the one paragraph mark beyond the last story's end every one of these plexes' own "second-to-last CP MUST be ccp - 1" rule requires, and builds the plex from the story starts plus that rule's two trailing keys.
function finishSubdocument(
  paragraphs: WriteParagraph[],
  storyStarts: readonly number[],
  characters: number,
): StorySubdocument {
  paragraphs.push(guardParagraph());
  const ccp = characters + 1;
  return {
    paragraphs,
    plex: buildCpOnlyPlex([...storyStarts, characters, ccp]),
    ccp,
  };
}

// The footnote/endnote/comment subdocument: one story per note, each note's own text split into paragraphs at the same newlines storyText joined on read (subdocument.ts), so the plain-text model round-trips exactly -- including a note whose text ends in "\n", whose trailing empty paragraph survives because this writer's guard is a SECOND mark beyond it, the identical two-mark spelling the reader's guard-drop rule inverts.
export function buildNoteSubdocument(
  notes: readonly { readonly text: string }[],
): StorySubdocument {
  const paragraphs: WriteParagraph[] = [];
  const storyStarts: number[] = [];
  let characters = 0;
  for (const note of notes) {
    storyStarts.push(characters);
    const story: WriteParagraph[] = note.text.split("\n").map((line) => ({
      runs: line === "" ? [] : [textRun(line)],
      properties: {},
      extraGrpprl: [],
      terminator: PARAGRAPH_MARK,
    }));
    story.push(guardParagraph());
    for (const paragraph of story) {
      characters += paragraphCharacters(paragraph);
    }
    paragraphs.push(...story);
  }
  return finishSubdocument(paragraphs, storyStarts, characters);
}

// The header subdocument: Plcfhdd's own fixed layout -- six footnote/endnote-separator stories (written as genuine empty stories, since neither side models one), then six per section in [MS-DOC]'s own fixed order (headers-footers.ts's SLOT_ORDER, the single source of that order both directions share). A story the model carries is written as present, even when its blocks flatten to nothing (an explicit empty paragraph holds it, so it reads back as a present-but-blank story rather than vanishing); a slot the model does not carry is left genuinely empty -- the "reuse the previous section's header/footer of this kind" meaning the reader already gives an empty story -- so absent slots stay absent across the round trip.
export function buildHeaderSubdocument(
  stories: readonly HeaderFooterStory[],
  sectionCount: number,
  dataStream: DataStreamBuilder,
  onWarning?: WriteWarning,
): StorySubdocument {
  const bySlot = new Map<string, HeaderFooterStory>();
  for (const story of stories) {
    if (
      !Number.isInteger(story.section) ||
      story.section < 0 ||
      story.section >= sectionCount
    ) {
      throw new DocFormatError(
        `a header/footer story names section ${String(story.section)}, but this document has ${String(sectionCount)} sections`,
      );
    }
    const key = `${String(story.section)}:${story.slot}`;
    if (bySlot.has(key)) {
      throw new DocFormatError(
        `more than one header/footer story was given for section ${String(story.section)}'s ${story.slot} slot; a slot holds one story`,
      );
    }
    bySlot.set(key, story);
  }

  const paragraphs: WriteParagraph[] = [];
  const storyStarts: number[] = [];
  let characters = 0;
  for (let count = 0; count < FIXED_SEPARATOR_STORY_COUNT; count += 1) {
    storyStarts.push(0);
  }
  for (let section = 0; section < sectionCount; section += 1) {
    for (const slot of SLOT_ORDER) {
      storyStarts.push(characters);
      const story = bySlot.get(`${String(section)}:${slot}`);
      if (story === undefined) continue;
      let content = flattenSectionBlocks(story.blocks, dataStream, onWarning);
      if (content.length === 0) {
        content = [
          {
            runs: [],
            properties: {},
            extraGrpprl: [],
            terminator: PARAGRAPH_MARK,
          },
        ];
      }
      content.push(guardParagraph());
      for (const paragraph of content) {
        characters += paragraphCharacters(paragraph);
      }
      paragraphs.push(...content);
    }
  }
  return finishSubdocument(paragraphs, storyStarts, characters);
}

/** Every story subdocument a document carries, in [MS-DOC]'s own concatenation order (footnote, header, comment, endnote -- the same order notes.ts/read.ts count ccp boundaries in), each undefined when the document carries none of that kind. */
export interface StorySubdocuments {
  readonly footnote: StorySubdocument | undefined;
  readonly header: StorySubdocument | undefined;
  readonly comment: StorySubdocument | undefined;
  readonly endnote: StorySubdocument | undefined;
}

/** The input type's own optional story fields, isolated here so buildStorySubdocuments states its shape once -- writeDocContent's WritableDocContent satisfies it directly. */
interface StorySources {
  readonly footnotes?: readonly { readonly text: string }[];
  readonly endnotes?: readonly { readonly text: string }[];
  readonly comments?: readonly { readonly text: string }[];
  readonly headerFooterStories?: readonly HeaderFooterStory[];
}

export function buildStorySubdocuments(
  document: StorySources &
    Pick<Extract<ContentDocument, { kind: "wordprocessing" }>, "sections">,
  dataStream: DataStreamBuilder,
  onWarning?: WriteWarning,
): StorySubdocuments {
  return {
    footnote:
      document.footnotes !== undefined && document.footnotes.length > 0
        ? buildNoteSubdocument(document.footnotes)
        : undefined,
    header:
      document.headerFooterStories !== undefined &&
      document.headerFooterStories.length > 0
        ? buildHeaderSubdocument(
            document.headerFooterStories,
            document.sections.length,
            dataStream,
            onWarning,
          )
        : undefined,
    comment:
      document.comments !== undefined && document.comments.length > 0
        ? buildNoteSubdocument(document.comments)
        : undefined,
    endnote:
      document.endnotes !== undefined && document.endnotes.length > 0
        ? buildNoteSubdocument(document.endnotes)
        : undefined,
  };
}
