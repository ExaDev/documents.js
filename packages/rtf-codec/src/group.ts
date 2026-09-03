// Group-shape helpers shared by the header parser (src/header.ts) and the body reader (src/read.ts): where a group ends, and which destination it opens.
//
// Both facts are stated by the specification rather than inferred. A group is "text, control words, or control symbols enclosed in braces", so its extent is ordinary brace matching. A destination is a control word that "marks the beginning of a collection of related text", and "destination changes are legal only immediately after an opening brace ({)" -- so the destination a group opens, if any, is named by its first control word, optionally preceded by the \* control symbol that "identifies destinations whose related text should be ignored if the RTF reader does not recognize the destination control word" (RTF 1.9.1, "Group", "Destinations", "Conventions of an RTF Reader").

import type { RtfToken } from "./tokenize";

export interface GroupHead {
  // The control word immediately opening the group, or undefined when the group opens with text or a control symbol instead -- which is legal and common: a formatting group like {\b bold text} opens with a formatting control word, and a bare {text} group opens with none at all.
  readonly destination: string | undefined;
  // Whether the group is marked with the \* control symbol, i.e. its content must be discarded whole if the destination is not recognised, rather than read as ordinary text.
  readonly ignorable: boolean;
  // Index of the first token that is neither the opening brace nor the \*/destination prefix -- where a parser for this destination should start reading.
  readonly contentStart: number;
}

// `start` is the index of the group's own groupStart token. Returns the index of its matching groupEnd, or tokens.length when the group is never closed -- an unbalanced input the caller recovers from rather than this helper throwing, since the specification's own advice is that "RTF readers should be robust enough to handle some minor variations".
export function matchingGroupEnd(
  tokens: readonly RtfToken[],
  start: number,
): number {
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const kind = tokens[index]?.kind;
    if (kind === "groupStart") {
      depth += 1;
      continue;
    }
    if (kind === "groupEnd") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return tokens.length;
}

// `start` is the index of the group's own groupStart token.
export function groupHead(
  tokens: readonly RtfToken[],
  start: number,
): GroupHead {
  let cursor = start + 1;
  let ignorable = false;
  const first = tokens[cursor];
  if (first?.kind === "controlSymbol" && first.symbol === "*") {
    ignorable = true;
    cursor += 1;
  }
  const head = tokens[cursor];
  if (head?.kind !== "controlWord") {
    return { destination: undefined, ignorable, contentStart: cursor };
  }
  return { destination: head.name, ignorable, contentStart: cursor + 1 };
}
