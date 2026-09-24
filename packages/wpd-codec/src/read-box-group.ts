import { bytesToBase64 } from "byte-codec";
import type {
  ContentBlock,
  ContentEmbeddedObjectBlock,
  ContentParagraph,
} from "document-schema.js";
import { WpdDiagnosticCodes, type WpdDiagnosticSink } from "./diagnostics";
import { flushParagraphIfContent, reportOnce, targetBlocks } from "./read-runs";
import type { FoldTokensFn, ReaderState } from "./read-state";
import type { WpdDocumentContainer } from "./container/container";
import {
  PACKET_TYPE_GENERAL_WP_TEXT,
  packetByPrefixId,
  readGeneralWpTextBlocks,
} from "./container/prefix";
import {
  BOX_CONTENT_TYPE_EQUATION,
  BOX_CONTENT_TYPE_IMAGE,
  BOX_CONTENT_TYPE_LINKED_TEXT,
  BOX_CONTENT_TYPE_TEXT,
  readBoxContent,
} from "./stream/box";
import {
  PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA,
  PACKET_TYPE_GRAPHICS_FILENAME,
  readGraphicsChildIds,
  readOleObject,
} from "./stream/ole";
import { scanImagePayload } from "./stream/image";
import { decodeWpgGraphic, type WpgDecode } from "./stream/wpg";
import { tokeniseDocumentArea, type WpdToken } from "./stream/tokenise";
import {
  DEFAULT_MARGIN_PT,
  DEFAULT_PAGE_HEIGHT_PT,
  DEFAULT_PAGE_WIDTH_PT,
} from "./stream/page";

// Box-content handling split out of read.ts: lifting a box's image, native OLE, WPG graphic, or WP-text/equation content into the shared schema, given the fold continuation read.ts wires in (a box's own text or a WPG graphic's own Text Data is folded through the identical machinery the main document area uses).

// The plain text a box's own equation content contributes to its residue: every paragraph's runs, joined, with paragraphs themselves joined by a newline. Deliberately not real MathML, WordPerfect's own equation notation is neither MathML nor LaTeX, and this reader has no grammar for it, so the raw notation is carried verbatim through ContentFormula's own residue channel (source.ts) rather than mislabelled as either.
function plainTextOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is ContentParagraph => block.kind === "paragraph")
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
    .join("\n");
}

// Lifts a box's own text, linked-text, or equation content, per stream/box.ts's own function-level override walk: a box's real content is ALWAYS named there (never its template), as the prefix ID of a General WP Text packet (type 0x08) whose own text blocks are this format's ordinary function-code stream, readable through the identical tokeniser and fold the main document area uses. A box the override walk cannot resolve real content or a trustworthy frame for, or whose content type is image/OLE/presentation/other (this reader has no decoder for any of those payload shapes), stays reported through the diagnostic sink rather than guessed at.
//
// A box's WPG vector graphic: the Graphics Filename packet's 0x6F (Graphics Cached File Data) children each carry a whole graphics file's bytes ("Contains WPG cached file contents"), and the first child whose bytes decode as a WPG graphic wins. The graphic's own Text Data records are WP document streams, folded here through the identical tokeniser and fold the main document area uses, the same fold a box's WP-text content and a header body take.
function decodeBoxWpg(
  container: WpdDocumentContainer,
  graphicsPacket: Parameters<typeof readGraphicsChildIds>[0],
  sink: WpdDiagnosticSink,
  foldTokens: FoldTokensFn,
): WpgDecode | undefined {
  const childIds = readGraphicsChildIds(graphicsPacket);
  if (childIds === undefined) {
    return undefined;
  }
  for (const childId of childIds) {
    const child = packetByPrefixId(container.packets, childId);
    if (child?.packetType !== PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA) {
      continue;
    }
    const decoded = decodeWpgGraphic(child.bytes, {
      foldTextData: (documentArea) =>
        foldTokens(
          tokeniseDocumentArea(documentArea, 0, documentArea.length),
          container,
          sink,
        ).blocks,
    });
    if (decoded !== undefined) {
      return decoded;
    }
  }
  return undefined;
}

export function applyBoxGroup(
  state: ReaderState,
  token: Extract<WpdToken, { kind: "variableFunction" }>,
  container: WpdDocumentContainer,
  sink: WpdDiagnosticSink,
  foldTokens: FoldTokensFn,
): void {
  const boxContent = readBoxContent(token.nonDeletable, token.prefixIds);
  if (boxContent === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxDropped,
      "This document contains a box — a figure, text box, equation, or graphic — whose function-level override names no content this reader can resolve.",
    );
    return;
  }

  // IMAGE content: the content prefix names a packet whose container spelling this reader has no specification for, so the lift is magic-driven, scan the packet's raw bytes for a whole, structurally delimited PNG or JPEG payload (stream/image.ts) and carry exactly that span as a ContentImageBlock, never a guess at a container header. The box's own frame supplies the rendered size, and its absolute-from-page-edge position (the one case stream/box.ts can resolve) becomes the image's floatPosition, the same anchored-position field a docx floating image carries. A packet that carries no raster is next tested for the two child-packet spellings a Graphics Filename packet (type 0x40) can name: a native OLE object (stream/ole.ts) and a WPG vector graphic (stream/wpg.ts).
  if (boxContent.contentType === BOX_CONTENT_TYPE_IMAGE) {
    const imagePacket = packetByPrefixId(
      container.packets,
      boxContent.contentPrefixId,
    );
    const payload =
      imagePacket === undefined
        ? undefined
        : scanImagePayload(imagePacket.bytes);
    if (payload === undefined) {
      const ole =
        imagePacket?.packetType === PACKET_TYPE_GRAPHICS_FILENAME
          ? readOleObject(
              container.packets,
              imagePacket,
              container.oleObjectStreams,
            )
          : undefined;
      if (ole !== undefined) {
        // The bytes are recovered but the flat ContentDocument has nowhere to put them, the same split a note body takes. The frame is deliberately not required here: an attachment entry names bytes, it places nothing.
        state.oleObjects.push(ole);
        return;
      }
      const wpg =
        imagePacket?.packetType === PACKET_TYPE_GRAPHICS_FILENAME
          ? decodeBoxWpg(container, imagePacket, sink, foldTokens)
          : undefined;
      if (wpg !== undefined) {
        if (wpg.status === "refused") {
          sink({
            code: WpdDiagnosticCodes.WpgRecordsUndecoded,
            message:
              wpg.reason === "wpg1"
                ? "This document embeds a WPG 1.0 vector graphic, whose type-and-length record vocabulary predates the framed WPG 2.x stream this reader decodes, so it was not lifted."
                : wpg.reason === "encrypted"
                  ? "This document embeds an encrypted WPG vector graphic, which this reader does not decrypt, so it was not lifted."
                  : "This document embeds a WPG graphic whose record stream this reader could not walk (no well-formed Start WPG record), so it was not lifted.",
          });
          return;
        }
        if (boxContent.frame === undefined) {
          reportOnce(
            state,
            sink,
            WpdDiagnosticCodes.BoxFrameUnresolved,
            "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
          );
          return;
        }
        if (wpg.skippedRecords.length > 0) {
          sink({
            code: WpdDiagnosticCodes.WpgRecordsUndecoded,
            message: `This document embeds a WPG vector graphic that partially decoded; the following record types were skipped: ${wpg.skippedRecords.join(", ")}.`,
          });
        }
        // The decoded graphic rides as a nested one-page drawing document, ContentEmbeddedObject's own 'drawing' objectKind, the shape this schema defines for exactly "a document of one kind nested at a frame inside a document of another", with the box's own frame placing it in the flow.
        flushParagraphIfContent(state, sink);
        targetBlocks(state).push({
          kind: "embeddedObject",
          objectKind: "drawing",
          frame: {
            xPt: boxContent.frame.xPt,
            yPt: boxContent.frame.yPt,
            widthPt: boxContent.frame.widthPt,
            heightPt: boxContent.frame.heightPt,
          },
          document: {
            kind: "drawing",
            metadata: {},
            pages: [
              {
                size: wpg.sizePt,
                shapes: [...wpg.shapes],
                vectors: [...wpg.vectors],
              },
            ],
          },
        });
        return;
      }
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.BoxContentUnresolved,
        "This document contains an image box whose content packet carries no decodable PNG or JPEG payload — a WPG graphic or other image spelling this reader does not decode.",
      );
      return;
    }
    if (boxContent.frame === undefined) {
      reportOnce(
        state,
        sink,
        WpdDiagnosticCodes.BoxFrameUnresolved,
        "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
      );
      return;
    }
    flushParagraphIfContent(state, sink);
    targetBlocks(state).push({
      kind: "image",
      format: payload.format,
      base64: bytesToBase64(payload.bytes),
      widthPt: boxContent.frame.widthPt,
      heightPt: boxContent.frame.heightPt,
      ...(boxContent.frame.positionResolved
        ? {
            floatPosition: {
              horizontal: {
                relativeTo: "page",
                offsetPt: boxContent.frame.xPt,
              },
              vertical: {
                relativeTo: "page",
                offsetPt: boxContent.frame.yPt,
              },
            },
          }
        : {}),
    });
    return;
  }

  const isTextLike =
    boxContent.contentType === BOX_CONTENT_TYPE_TEXT ||
    boxContent.contentType === BOX_CONTENT_TYPE_LINKED_TEXT ||
    boxContent.contentType === BOX_CONTENT_TYPE_EQUATION;
  const packet = isTextLike
    ? packetByPrefixId(container.packets, boxContent.contentPrefixId)
    : undefined;
  const textBlocks =
    packet?.packetType !== PACKET_TYPE_GENERAL_WP_TEXT
      ? undefined
      : readGeneralWpTextBlocks(packet.bytes);
  if (textBlocks === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxContentUnresolved,
      "This document contains a box whose content this reader could not read — an image, OLE object, or other content type this reader does not yet decode into the shared schema.",
    );
    return;
  }
  if (boxContent.frame === undefined) {
    reportOnce(
      state,
      sink,
      WpdDiagnosticCodes.BoxFrameUnresolved,
      "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
    );
    return;
  }

  flushParagraphIfContent(state, sink);
  const nestedTokens = tokeniseDocumentArea(textBlocks, 0, textBlocks.length);
  const frame = {
    xPt: boxContent.frame.xPt,
    yPt: boxContent.frame.yPt,
    widthPt: boxContent.frame.widthPt,
    heightPt: boxContent.frame.heightPt,
  };

  if (boxContent.contentType === BOX_CONTENT_TYPE_EQUATION) {
    const { blocks } = foldTokens(nestedTokens, container, sink);
    const embed: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      frame,
      document: {
        kind: "formula",
        metadata: {},
        formula: {
          mathml: [],
          source: { format: "wpd", xml: plainTextOf(blocks) },
        },
      },
    };
    targetBlocks(state).push(embed);
    return;
  }

  const { blocks, page } = foldTokens(nestedTokens, container, sink);
  const embed: ContentEmbeddedObjectBlock = {
    kind: "embeddedObject",
    objectKind: "wordprocessing",
    frame,
    document: {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: {
            widthPt: page.widthPt ?? DEFAULT_PAGE_WIDTH_PT,
            heightPt: page.heightPt ?? DEFAULT_PAGE_HEIGHT_PT,
          },
          margins: {
            topPt: page.topPt ?? DEFAULT_MARGIN_PT,
            rightPt: page.rightPt ?? DEFAULT_MARGIN_PT,
            bottomPt: page.bottomPt ?? DEFAULT_MARGIN_PT,
            leftPt: page.leftPt ?? DEFAULT_MARGIN_PT,
          },
          blocks,
        },
      ],
    },
  };
  targetBlocks(state).push(embed);
}
