import type { MarkdownOpenDocument, OpenDocument } from '../../../state/types.js';

// Every screen in this directory is only ever reached from `markdownLineList`, the root screen `rootScreenForFormat` produces exclusively for an open markdown document -- so `state.openDocument` is always a `MarkdownOpenDocument` by the time either screen here renders. This throws rather than falling back to an empty view because a mismatch would mean the app router itself is broken, not a recoverable, user-facing condition -- and, just as importantly, lets both screens call their own hooks (`useNavigationInput`) unconditionally before any early return, which a `doc?.format !== 'markdown'` guard followed by a conditional `return` would violate.
export function requireMarkdownDocument(openDocument: OpenDocument | undefined): MarkdownOpenDocument {
  if (openDocument?.format !== 'markdown') {
    throw new Error('A markdown editing screen rendered without an open markdown document; the app router only reaches this screen group from markdownLineList, which is only ever the root screen of an open markdown document.');
  }
  return openDocument;
}
