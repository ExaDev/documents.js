import type { OdbOpenDocument, OpenDocument } from '../../../state/types.js';

// Every screen in this directory is only ever reached from `odbTableList`, the root screen `rootScreenForFormat` produces exclusively for an open `.odb` document -- so `state.openDocument` is always an `OdbOpenDocument` by the time either screen here renders. This throws rather than falling back to an empty view because a mismatch would mean the app router itself is broken, not a recoverable, user-facing condition.
export function requireOdbDocument(openDocument: OpenDocument | undefined): OdbOpenDocument {
  if (openDocument?.format !== 'odb') {
    throw new Error('An .odb browsing screen rendered without an open .odb document; the app router only reaches this screen group from odbTableList, which is only ever the root screen of an open .odb document.');
  }
  return openDocument;
}
