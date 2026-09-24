// The token loop: RTF's own reader model implemented literally (RTF 1.9.1, "Conventions of an RTF Reader") - an opening brace stacks the current state, a closing brace pops it, a backslash collects a control word or symbol and dispatches on it (read-control-words.ts's own applyControlWord), and anything else is text written to the current destination.
import { appendBytes, asciiStringFromBytes } from "./bytes";
import { decodeCodepageBytes } from "./codepage";
import { formFieldContentControl, formFieldControlType } from "./constructs";
import {
  RtfDiagnosticCodes,
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  type RtfDiagnostic,
  type RtfDiagnosticSink,
} from "./diagnostics";
import { groupHead, matchingGroupEnd } from "./group";
import { HEADER_DESTINATIONS, readRtfHeader } from "./header";
import {
  DEFAULT_MAX_GROUP_DEPTH,
  DEFAULT_MAX_INPUT_BYTES,
  type ReadRtfOptions,
} from "./options";
import { tokenizeRtf } from "./tokenize";
import { ContentBuilder } from "./read-builder";
import {
  buildEmbeddedObject,
  buildPicture,
  defaultPictureState,
  defaultSectionState,
} from "./read-build";
import { applyControlWord, assertRtfHeaderPresent } from "./read-control-words";
import {
  DESTINATION_KINDS,
  SILENT_SKIP_DESTINATIONS,
  SPECIAL_CHARACTER_TEXT,
  SPECIAL_SYMBOL_TEXT,
  appendObjectDataHexText,
  appendToLastListItem,
  cloneGroupState,
  defaultCharacterState,
  defaultParagraphState,
  hyperlinkFromInstruction,
  skipUnicodeFallback,
  type DestinationKind,
  type GroupState,
  type ReadRtfContentResult,
} from "./read-state";

export function readRtfDetail(
  input: Uint8Array,
  options: ReadRtfOptions,
): ReadRtfContentResult {
  options.signal?.throwIfAborted();

  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  if (input.length > maxInputBytes) {
    throw new RtfInputTooLargeError(input.length, maxInputBytes);
  }
  const maxGroupDepth = options.maxGroupDepth ?? DEFAULT_MAX_GROUP_DEPTH;

  const diagnostics: RtfDiagnostic[] = [];
  const callerSink = options.sink;
  const sink: RtfDiagnosticSink = (diagnostic) => {
    diagnostics.push(diagnostic);
    callerSink?.(diagnostic);
  };

  const tokens = tokenizeRtf(input);
  assertRtfHeaderPresent(tokens);
  const header = readRtfHeader(tokens, sink);
  const builder = new ContentBuilder(header, sink);
  const section = defaultSectionState(header);

  // pictureOwner/objectDataOwner/objectOwner/isFieldGroup are each omitted below rather than stated as `false`: every check that reads one of them (the groupEnd handler's own `state.picture !== undefined && state.pictureOwner`, `state.objectData !== undefined && state.objectDataOwner`, `state.object !== undefined && state.objectOwner`, `state.isFieldGroup && state.field?.formFieldStarted === true`) is a short-circuited `&&` whose OTHER operand — picture/objectData/object/field — is ALSO `undefined` on this root object and can only ever become defined on a freshly cloned CHILD, in the very same branch that also sets its own Owner/isFieldGroup flag true. Since root's own picture/objectData/object/field never change (nothing ever assigns to root directly; every mutation targets a `child` object instead), the paired `undefined` operand already makes each `&&` false regardless of these four fields' own value here, for as long as `state` could ever actually be this root object at one of those check sites (including the state-still-root case of a stray extra closing brace after the document's own root group has already closed) — so there is no real `false` to state, only an absent field, which the optional typing above lets this literal say directly.
  const root: GroupState = {
    destination: "body",
    uc: 1, // "A default of 1 should be assumed if no \ucN keyword has been seen in the current or outer scopes."
    char: defaultCharacterState(),
    para: defaultParagraphState(),
    field: undefined,
    picture: undefined,
    objectData: undefined,
    object: undefined,
    resultOf: undefined,
    bookmark: undefined,
    inUnicodeWrapper: false,
  };
  const stack: GroupState[] = [root];
  let state = root;

  // Consecutive ANSI bytes are buffered and decoded as one run, because \ansicpg65001 is UTF-8 and a stateful encoding cannot be decoded a byte at a time. The buffer is flushed at the first event that is not another byte.
  let pendingBytes: number[] = [];
  const activeCodepage = (): number => {
    const fontPage =
      state.char.fontIndex === undefined
        ? undefined
        : header.fonts.get(state.char.fontIndex)?.codepage;
    return fontPage ?? header.codepage;
  };
  const emitText = (text: string): void => {
    if (state.destination === "body") {
      const hyperlink =
        state.field === undefined
          ? undefined
          : hyperlinkFromInstruction(state.field.instruction);
      builder.appendText(text, state.char, hyperlink);
      return;
    }
    if (state.destination === "fieldInstruction" && state.field !== undefined) {
      state.field.instruction += text;
      return;
    }
    if (
      (state.destination === "bookmarkStart" ||
        state.destination === "bookmarkEnd") &&
      state.bookmark !== undefined
    ) {
      // The bookmark's own #PCDATA is its name, and the two halves are "matched with the bookmark tag".
      state.bookmark.name += text;
      return;
    }
    if (
      state.destination === "formFieldName" &&
      state.field?.formField !== undefined
    ) {
      state.field.formField.name += text;
      return;
    }
    if (
      state.destination === "formFieldHelpText" &&
      state.field?.formField !== undefined
    ) {
      state.field.formField.helpText += text;
      return;
    }
    if (
      state.destination === "formFieldListItem" &&
      state.field?.formField !== undefined
    ) {
      // Appends to the LAST item: a \*\ffl group's own open pushed one empty entry per occurrence, so several sibling \*\ffl groups (a dropdown's list) each accumulate into their own slot rather than one shared string.
      appendToLastListItem({ items: state.field.formField.listItems }, text);
      return;
    }
    // "picture" text is handled directly at the token site (it is hex, not characters); "skip", "listText", "unicodeWrapper" and "formField" discard — \*\ffdeftext (FFData.xstzTextDef) is one of these now, per SILENT_SKIP_DESTINATIONS above.
  };

  const flushBytes = (): void => {
    if (pendingBytes.length === 0) {
      return;
    }
    const text = decodeCodepageBytes(
      Uint8Array.from(pendingBytes),
      activeCodepage(),
      sink,
    );
    pendingBytes = [];
    emitText(text);
  };

  let index = 0;
  let textOffset = 0;
  // No `index < tokens.length` bound: a read past the array's own end is `undefined` rather than a thrown error, and the very next line's own `if (token === undefined) { break; }` already terminates the loop on exactly that condition — a separate length check here would only ever restate it.
  while (true) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }

    if (token.kind === "groupStart") {
      flushBytes();
      const head = groupHead(tokens, index);
      const known =
        head.destination === undefined
          ? undefined
          : DESTINATION_KINDS.get(head.destination);
      const isHeaderTable =
        head.destination !== undefined &&
        HEADER_DESTINATIONS.has(head.destination);
      const wrapperChild = state.inUnicodeWrapper;
      // \result is \object's own fallback rendering for a reader that cannot decode \objdata at all — this reader always prefers \objdata, so \result's content is rendered into a totally isolated scratch accumulator (ContentBuilder's own beginResultScratch, called below once this group is actually entered) and only spliced into the real document, at \object's own group-end handling further down, if \objdata never decodes. objectState is the enclosing \object's own shared-by-reference state.
      const objectState = state.object;
      const isResultDestination =
        head.destination === "result" && objectState !== undefined;
      // RTF's own <obj> grammar allows only one \result child, but a malformed producer can still write two — recognised here, mirroring \objdata's own duplicate check just below, by resultSeen already being true from the first one, so the second is skipped whole rather than rendered into a scratch accumulator nothing will read.
      // objectState is provably defined here: isResultDestination's own definition already asserts `objectState !== undefined`, and TypeScript's aliased-condition narrowing carries that through the `&&` below.
      const isDuplicateResult = isResultDestination && objectState.resultSeen;
      // No separate `objectState !== undefined &&` clause: isResultDestination's own definition already asserts it, and the same TypeScript aliased-condition narrowing the comment above relies on carries through this bare check too.
      if (isResultDestination) {
        // Recorded regardless of whether this \result is ultimately kept or discarded: \object's own group-end diagnostic (below) needs to know whether a \result existed at all, distinctly from whether \objdata did, and the duplicate check just above needs it too.
        objectState.resultSeen = true;
      }
      if (isDuplicateResult) {
        sink({
          code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
          severity: "warning",
          message:
            "an \\object destination has more than one \\result child, which RTF's own grammar does not allow; only the first is kept and this one is discarded",
        });
      }
      // RTF's own <obj> grammar allows only one \objdata child, but a malformed producer can still write two — recognised here (rather than left to decode twice into two identical embeddedObject blocks) by objectDataSeen already being true from the first one. No separate `head.destination === "objdata"` clause: DESTINATION_KINDS maps exactly one key ("objdata") to the "objectData" kind, so `known === "objectData"` alone already states it.
      const isObjectDataDestination = known === "objectData";
      const isDuplicateObjectData =
        isObjectDataDestination && objectState?.objectDataSeen === true;
      if (isDuplicateObjectData) {
        sink({
          code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
          severity: "warning",
          message:
            "an \\object destination has more than one \\objdata child, which RTF's own grammar does not allow; only the first is decoded and this one is discarded",
        });
      } else if (isObjectDataDestination && objectState !== undefined) {
        objectState.objectDataSeen = true;
      }
      // The ANSI half of a {\upr {ansi} {\*\ud unicode}} pair is discarded and the \ud half read, which is exactly what the spec says a Unicode-aware reader must do: the \upr destination "does not use the \* keyword; this forces the old RTF readers to pick up the ANSI representation and discard the Unicode one".
      const kind: DestinationKind =
        isHeaderTable || (wrapperChild && head.destination !== "ud")
          ? "skip"
          : isDuplicateObjectData || isDuplicateResult
            ? "skip"
            : isResultDestination
              ? "body"
              : (known ?? (head.ignorable ? "skip" : state.destination));
      if (head.destination !== undefined && !isHeaderTable) {
        if (head.ignorable && known === undefined) {
          sink({
            code: RtfDiagnosticCodes.UNKNOWN_DESTINATION_SKIPPED,
            severity: "info",
            message: `the ignorable destination \\${head.destination} is not recognised and its content is discarded, as the specification requires`,
          });
        } else if (
          known === "skip" &&
          !SILENT_SKIP_DESTINATIONS.has(head.destination)
        ) {
          // A destination this reader recognises and still discards: a note, an annotation, page furniture, an embedded object. Reported rather than dropped silently, because a reader that says nothing about a construct it decided not to place is indistinguishable from one that never saw it — and in a format whose readers are REQUIRED to ignore what they do not recognise, that distinction is the only thing a caller has.
          sink({
            code: RtfDiagnosticCodes.CONTENT_DESTINATION_SKIPPED,
            severity: "warning",
            message: `the \\${head.destination} destination's content is discarded: no ContentDocument position carries it`,
          });
        }
      }
      if (kind === "skip") {
        index = matchingGroupEnd(tokens, index) + 1;
        textOffset = 0;
        continue;
      }
      if (stack.length >= maxGroupDepth) {
        throw new RtfNestingLimitExceededError(maxGroupDepth);
      }
      const child = cloneGroupState(state);
      child.inUnicodeWrapper = kind === "unicodeWrapper";
      // Recomputed on every group open rather than inherited from the clone, exactly like inUnicodeWrapper above: state.field is shared by reference down through a \field group's whole subtree, so without an explicit reset here every descendant group (\*\fldinst, \*\formfield, \fldrslt) would also read as "is the field's own group" and the close handler below would fire once per descendant instead of once for the field itself.
      child.isFieldGroup = head.destination === "field";
      if (known !== undefined) {
        child.destination = kind;
        if (child.isFieldGroup) {
          // No `builder.startFormField()` here: the instruction (this field's own `\*\fldinst` content) is still empty at this point, so formFieldControlType has nothing to decide a genuine form field from yet. The extent opens later, at `\*\fldinst`'s own close below, once that decision is actually possible.
          child.field = {
            instruction: "",
            formField: undefined,
            formFieldStarted: false,
          };
        }
        if (head.destination === "formfield" && child.field !== undefined) {
          // Mutates the SAME FieldState object the enclosing \field group's own children all share by reference, so \*\ffname/\*\ffl (nested inside this group) and the \field group's own closing brace (which reads it back to build the descriptor) see the identical data.
          child.field.formField = {
            name: "",
            helpText: "",
            ownHelp: false,
            listItems: [],
            resultIndex: undefined,
            defaultResultIndex: undefined,
            protectedField: false,
          };
        }
        if (
          head.destination === "ffl" &&
          child.field?.formField !== undefined
        ) {
          child.field.formField.listItems.push("");
        }
        if (kind === "picture") {
          child.picture = defaultPictureState();
          child.pictureOwner = true;
        }
        if (kind === "objectData") {
          child.objectData = { bytes: [], pendingHexNibble: undefined };
          child.objectDataOwner = true;
        }
        if (kind === "object") {
          // Freshly resolved here as the group is actually entered, not predicted ahead of time — \objdata and \result (below) each report into this same shared state as they are actually read, and \object's own group-end handling (further down) reads it back once every child has been.
          child.object = {
            decoded: false,
            objectDataSeen: false,
            resultSeen: false,
            resultBlocks: undefined,
            widthTwips: undefined,
            heightTwips: undefined,
          };
          child.objectOwner = true;
        }
        // No `kind === "bookmarkStart" || kind === "bookmarkEnd"` guard: state.bookmark, like pictureOwner/objectDataOwner/objectOwner on the root object earlier, is only ever acted on paired with a `state.destination === "bookmarkStart"`/`"bookmarkEnd"` check (both at group-end, below, and in emitText) — never on its own definedness. A stray bookmark object on some OTHER recognised destination's own child (say \object) is read back at that child's own group-end (`state.bookmark !== undefined`), but neither the bookmarkStart nor the bookmarkEnd branch beneath it ever fires, since `child.destination` is set from `kind` independently of this block and was never "bookmarkStart"/"bookmarkEnd" to begin with — so assigning a fresh (and, on any other destination, simply unread) bookmark here unconditionally changes nothing observable for any input.
        child.bookmark = {
          name: "",
          columnFirst: undefined,
          columnLast: undefined,
        };
        index = head.contentStart;
      } else {
        index += 1;
      }
      // No separate `objectState !== undefined &&` clause: isResultDestination's own definition already asserts it, and the same TypeScript aliased-condition narrowing the comment on isDuplicateResult above relies on carries through this bare check too.
      if (isResultDestination) {
        // Unreachable for a duplicate \result: isDuplicateResult forces kind to "skip" above, which continues the outer loop before this point is ever reached. \result's own content now builds into a totally isolated scratch accumulator (see ContentBuilder's own beginResultScratch) rather than the paragraph/block list/table state already accumulating around \object — so it can neither destroy that state nor be destroyed by it, regardless of where \object sits (mid-paragraph, inside a table cell, or anywhere else). `object` is cleared on this child (rather than inherited, as cloneGroupState would otherwise carry it forward by reference) so that a malformed \objdata nested inside \result's own fallback content — not itself wrapped in its own \object, which real RTF never does but a hostile or corrupt file could — decodes or fails entirely on its own terms, without marking THIS \object decoded.
        builder.beginResultScratch();
        child.resultOf = objectState;
        child.object = undefined;
        // cloneGroupState just copied \object's own para onto this child, inTable included — but \object's real placement (inside a table cell or not) is already captured correctly and permanently in `state.para.inTable` at \object's own group, read again once \object's own group-end decides where to splice this content (further down, addBlocks(objectState.resultBlocks, state.para.inTable)) and never touched again after \object opens. \result's own scratch rendering must not inherit that inTable value: freshAccumulatorState() gives the scratch empty cellBlocks/tableRows, so there is no real open cell for inherited-true content to belong to, and \result's own body may produce a run directly under this group (no nested braces, no \pard/\intbl of its own) before the group ever closes — in that bare case this reset is the only thing standing between the correct default and an inherited true left over from \object's own placement. It does not make `para.inTable` a reliable signal of where \result's content ends up by the time this group closes, though: \result's own body can still restate \intbl directly (mutating this same para back to true) or open a nested group whose own \pard resets ITS copy independently of this one, so a paragraph produced deeper in \result's content can land in either `blocks` or `cellBlocks` regardless of what this group's own para says afterwards. endResultScratch reads back from both lists for exactly that reason, rather than trusting this value to pick one.
        child.para = { ...child.para, inTable: false };
      }
      stack.push(child);
      state = child;
      textOffset = 0;
      continue;
    }

    if (token.kind === "groupEnd") {
      flushBytes();
      // No `state.destination === "picture"` check here: pictureOwner is set true only at the same moment a group's own destination becomes "picture" (below, on group open), and cloneGroupState resets it to false on every child regardless of what destination that child inherits — so pictureOwner true already implies this group's destination was "picture" for its own whole lifetime. The nested-plain-group case a malformed \pict can contain is exactly why the flag exists at all: that child inherits destination "picture" by reference but starts with its own fresh pictureOwner false, which is what pictureOwner (not destination) is the one actually gating here.
      if (state.picture !== undefined && state.pictureOwner === true) {
        const image = buildPicture(state.picture, sink);
        if (image !== undefined) {
          builder.addBlocks([image], state.para.inTable);
        }
      }
      // Same reasoning as pictureOwner above: objectDataOwner is set true only alongside destination "objectData" and reset false on every other child.
      if (state.objectData !== undefined && state.objectDataOwner === true) {
        const embedded = buildEmbeddedObject(
          state.objectData,
          state.object,
          sink,
        );
        if (embedded !== undefined) {
          builder.addBlocks([embedded], state.para.inTable);
          // Marks the enclosing \object's shared state so \object's own group-end handling below discards \result's fallback content instead of splicing it in alongside the real decoded object — this reader always prefers the real object over \object's own cached appearance, exactly as Word itself does.
          if (state.object !== undefined) {
            state.object.decoded = true;
          }
        }
      }
      if (state.resultOf !== undefined) {
        // \result's own scratch accumulator (opened by beginResultScratch when this group started) is finished now: every \par it contained has already closed a real paragraph inside it, and endResultScratch force-closes whatever paragraph was still open otherwise. Recorded, not yet acted on: \object's own group-end handling further up the stack either splices these blocks in or discards them once \objdata's real decode's fate is finally known, and this \result's own group-end cannot know that outcome when \result comes first in the source — \objdata may not even have been read yet.
        state.resultOf.resultBlocks = builder.endResultScratch(state.para);
      }
      // Same reasoning again: objectOwner is set true only alongside destination "object" and reset false on every other child.
      if (state.object !== undefined && state.objectOwner === true) {
        // Every child \objdata/\result this \object's own group can legally contain has, by construction, already closed by the time \object's own closing brace is reached — so `decoded`, `objectDataSeen` and `resultBlocks` are all final here, regardless of which sibling the source actually listed first.
        const objectState = state.object;
        if (!objectState.decoded && objectState.resultBlocks !== undefined) {
          // \objdata never decoded (or never existed at all): \result's own recovered content is appended, via the same addBlocks a decoded \pict/\object already uses, to whichever block list \object itself sits in — the open table cell's or the section's. That is not the same as splicing it into the exact position \object occupied: addBlocks only flushes the pending run, it does not end the paragraph \object was sitting inside, so an \object mid-paragraph (as in "before {\object...} after") gets its fallback content appended BEFORE that paragraph, once it eventually closes — with the text on either side of \object merged into that one paragraph rather than split around the fallback.
          builder.addBlocks(objectState.resultBlocks, state.para.inTable);
        }
        // An \object whose \objdata genuinely exists but fails to decode already reports that failure on its own terms (buildEmbeddedObject's own EMBEDDED_OBJECT_UNREADABLE, above) — this diagnostic is only for the two cases where NOTHING already said so: no \objdata at all, with \result's content used in its place, or no \objdata AND no \result, where the whole construct is silently dropped.
        if (!objectState.objectDataSeen) {
          sink({
            code: RtfDiagnosticCodes.EMBEDDED_OBJECT_UNREADABLE,
            severity: "warning",
            message: objectState.resultSeen
              ? "an \\object destination has no \\objdata payload at all; its \\result fallback content is used in its place"
              : "an \\object destination has neither \\objdata nor \\result content; the whole construct is dropped",
          });
        }
      }
      if (state.bookmark !== undefined) {
        // The name is complete only now: it is the destination's own text, so the closing brace is the first point at which the whole of it has been read.
        const bookmark = {
          ...state.bookmark,
          name: state.bookmark.name.trim(),
        };
        if (state.destination === "bookmarkStart") {
          builder.startBookmark(bookmark, state.para);
        } else if (state.destination === "bookmarkEnd") {
          builder.endBookmark(bookmark.name);
        }
      }
      if (
        state.destination === "fieldInstruction" &&
        state.field !== undefined &&
        !state.field.formFieldStarted &&
        formFieldControlType(state.field.instruction) !== undefined
      ) {
        // \*\fldinst's own instruction text is complete now (it is the only destination that appends to it), so this is the earliest point a genuine form field (FORMTEXT/FORMCHECKBOX/FORMDROPDOWN) can be told apart from an ordinary field (PAGE, DATE, NUMPAGES, and the rest) — opening the extent here, rather than unconditionally at \field's own open, means an ordinary field never calls startFormField/flushRun at all. Guarded on formFieldStarted (see FieldState's own comment) because a real Word-authored \*\fldinst wraps its instruction text in its own anonymous nested group, which inherits this same "fieldInstruction" destination and would otherwise reach this branch a second time when it closes.
        builder.startFormField();
        state.field.formFieldStarted = true;
      }
      if (
        state.isFieldGroup === true &&
        state.field?.formFieldStarted === true
      ) {
        // The whole field is read by now — \*\fldinst and \*\formfield are this group's own earlier children, already closed — so this is the one point that knows both the instruction and whatever form-field data it carried. Gated on formFieldStarted, not on `descriptor` being defined: startFormField above already opened this field's extent (an ordinary field, which never does, correctly never reaches endFormField either), and endFormField's own job is closing whatever startFormField opened — not re-deciding whether it should have been opened from a second, independently re-derived read of the instruction, which is exactly what let open and close firing conditions drift apart (see endFormField's own comment on `descriptor` possibly being undefined here).
        const descriptor = formFieldContentControl(
          state.field.instruction,
          state.field.formField,
        );
        builder.endFormField(descriptor);
      }
      if (stack.length > 1) {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (parent !== undefined) {
          state = parent;
        }
      } else {
        sink({
          code: RtfDiagnosticCodes.UNBALANCED_GROUP,
          severity: "warning",
          message:
            "a closing brace appeared with no group open; the extra brace is ignored",
          tokenIndex: index,
        });
      }
      index += 1;
      textOffset = 0;
      continue;
    }

    if (token.kind === "text") {
      const slice =
        textOffset === 0 ? token.bytes : token.bytes.subarray(textOffset);
      if (state.destination === "picture" && state.picture !== undefined) {
        state.picture.hex += asciiStringFromBytes(slice);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        appendObjectDataHexText(state.objectData, asciiStringFromBytes(slice));
      } else {
        appendBytes({ bytes: pendingBytes }, slice);
      }
      index += 1;
      textOffset = 0;
      continue;
    }

    if (token.kind === "binary") {
      if (state.destination === "picture" && state.picture !== undefined) {
        appendBytes({ bytes: state.picture.binary }, token.bytes);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        appendBytes({ bytes: state.objectData.bytes }, token.bytes);
      }
      index += 1;
      continue;
    }

    if (token.kind === "hex") {
      if (state.destination === "picture" && state.picture !== undefined) {
        // A \'hh inside a picture destination is payload, not text: the hex digits themselves were already consumed by the tokenizer, so the byte goes straight into the binary buffer.
        state.picture.binary.push(token.byte);
      } else if (
        state.destination === "objectData" &&
        state.objectData !== undefined
      ) {
        state.objectData.bytes.push(token.byte);
      } else {
        pendingBytes.push(token.byte);
      }
      index += 1;
      continue;
    }

    if (token.kind === "controlSymbol") {
      const text = SPECIAL_SYMBOL_TEXT.get(token.symbol);
      if (text !== undefined) {
        flushBytes();
        emitText(text);
      }
      index += 1;
      continue;
    }

    // Control word.
    if (token.name === "u") {
      flushBytes();
      const code = token.param;
      if (code !== undefined) {
        // "Unicode values greater than 32767 are expressed as negative numbers ... convert F020 to decimal (61472) and subtract 65536." No explicit "add 65536 back for a negative code" step is needed to undo that, though: String.fromCharCode's own ToUint16 argument coercion already reduces ANY integer modulo 2**16 before treating it as a UTF-16 code unit, so fromCharCode(-4064) and fromCharCode(-4064 + 65536) are the identical call — the spec's own subtract-65536 encoding step is already exactly what fromCharCode's argument coercion undoes on its own, with no conditional needed on this side to reverse it. A lone surrogate is emitted with fromCharCode so a surrogate pair written as two \uN keywords composes into one astral character.
        emitText(String.fromCharCode(code));
      }
      const skipped = skipUnicodeFallback(tokens, index + 1, state.uc);
      index = skipped.index;
      textOffset = skipped.textOffset;
      continue;
    }

    const special = SPECIAL_CHARACTER_TEXT.get(token.name);
    if (special !== undefined) {
      flushBytes();
      emitText(special);
      index += 1;
      continue;
    }

    flushBytes();
    applyControlWord(
      token.name,
      token.param,
      state,
      builder,
      header,
      { section },
      sink,
    );
    index += 1;
  }

  flushBytes();
  if (stack.length > 1) {
    sink({
      code: RtfDiagnosticCodes.UNBALANCED_GROUP,
      severity: "warning",
      message: `${String(stack.length - 1)} group(s) were still open at the end of the input; each is treated as closing there`,
    });
  }

  const document = builder.finish(header.metadata, section, root.para);
  return { document, diagnostics };
}
