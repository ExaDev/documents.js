import { describe, expect, it } from 'vitest';
import type { Package, Part } from '../../model/package';
import { el, txt } from '../../xml/fragment';
import { readXlsxContent } from './content';

// Cell-comment fixtures are synthetic el/txt packages (content.test.ts's own convention for markup its real fixtures never exercise): the comment parts' producers are genuinely varied -- Excel's legacy rich-run notes, openpyxl's plain-text notes, Excel 365's unprefixed [MS-XLSX] threads, older producers' prefixed dCreation/displayName vocabulary -- and LibreOffice, which authors the real fixtures, only ever writes the legacy spelling. Every package's worksheet part carries its own .rels naming the comment parts, the one and only address comments are ever resolved through.

const REL_WORKSHEET = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
const REL_THREADED_COMMENTS = 'http://schemas.microsoft.com/office/2017/10/relationships/threadedComment';
const REL_PERSON = 'http://schemas.microsoft.com/office/2017/10/relationships/person';

// A single-sheet package whose worksheet part carries its own .rels (the thing that names the comment parts) plus whatever extra parts a test supplies. The sheet holds two ordinary numeric cells, A1 and B1, so a comment attached to an existing cell and a cell with no comment at all are both always in play; a comment anywhere else exercises materialising a cell the sheetData never wrote.
function buildCommentedPackage(sheetRelationships: ReturnType<typeof el>[], extraParts: Record<string, Part>): Package {
  const parts: Package['parts'] = {
    'xl/workbook.xml': {
      kind: 'xml',
      nodes: [el('workbook', {}, [el('sheets', {}, [el('sheet', { name: 'Sheet1', 'r:id': 'rId1' })])])],
    },
    'xl/_rels/workbook.xml.rels': {
      kind: 'xml',
      nodes: [el('Relationships', {}, [el('Relationship', { Id: 'rId1', Type: REL_WORKSHEET, Target: 'worksheets/sheet1.xml' })])],
    },
    'xl/worksheets/sheet1.xml': {
      kind: 'xml',
      nodes: [
        el('worksheet', {}, [
          el('sheetData', {}, [
            el('row', { r: '1' }, [
              el('c', { r: 'A1' }, [el('v', {}, [txt('42')])]),
              el('c', { r: 'B1' }, [el('v', {}, [txt('7')])]),
            ]),
          ]),
        ]),
      ],
    },
  };
  if (sheetRelationships.length > 0) {
    parts['xl/worksheets/_rels/sheet1.xml.rels'] = { kind: 'xml', nodes: [el('Relationships', {}, sheetRelationships)] };
  }
  for (const [path, part] of Object.entries(extraParts)) {
    parts[path] = part;
  }
  return { parts };
}

function readCommentedCells(sheetRelationships: ReturnType<typeof el>[], extraParts: Record<string, Part>) {
  const result = readXlsxContent(buildCommentedPackage(sheetRelationships, extraParts));
  if (result.kind !== 'spreadsheet') {
    throw new Error('expected a spreadsheet ContentDocument');
  }
  return result.sheets[0]?.cells ?? [];
}

function findCell(cells: ReturnType<typeof readCommentedCells>, row: number, column: number) {
  const cell = cells.find((candidate) => candidate.row === row && candidate.column === column);
  if (cell === undefined) {
    throw new Error(`expected a cell at row ${row}, column ${column}`);
  }
  return cell;
}

describe('readXlsxContent: cell comments -- legacy notes (xl/comments{N}.xml, synthetic packages)', () => {
  it('reads a legacy note through the sheet rels: rich-text runs concatenated, authorId resolved through the authors list, and an un-annotated sibling cell left with no comment field at all', () => {
    const cells = readCommentedCells(
      [el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments1.xml' })],
      {
        'xl/comments1.xml': {
          kind: 'xml',
          nodes: [
            el('comments', {}, [
              el('authors', {}, [el('author', {}, [txt('Joseph Mearman')]), el('author', {}, [txt('Sarah Smith')])]),
              el('commentList', {}, [
                el('comment', { ref: 'A1', authorId: '0' }, [
                  el('text', {}, [
                    el('r', {}, [el('rPr', {}, [el('b', {})]), el('t', {}, [txt('Note ')])]),
                    el('r', {}, [el('t', {}, [txt('body')])]),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({ text: 'Note body', author: 'Joseph Mearman' });
    expect(findCell(cells, 0, 1).comment).toBeUndefined();
  });

  it("reads openpyxl's plain-text <text> spelling (character content, no runs), and leaves author honestly unset when authorId points past the authors list", () => {
    const cells = readCommentedCells(
      [el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments1.xml' })],
      {
        'xl/comments1.xml': {
          kind: 'xml',
          nodes: [
            el('comments', {}, [
              el('authors', {}, [el('author', {}, [txt('Joseph Mearman')])]),
              el('commentList', {}, [el('comment', { ref: 'A1', authorId: '5' }, [el('text', {}, [txt('Plain note')])])]),
            ]),
          ],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({ text: 'Plain note' });
  });

  it('materialises an empty cell for a note anchored to a cell the sheetData never wrote -- the same policy that keeps an <f>-only formula cell', () => {
    const cells = readCommentedCells(
      [el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments1.xml' })],
      {
        'xl/comments1.xml': {
          kind: 'xml',
          nodes: [
            el('comments', {}, [el('commentList', {}, [el('comment', { ref: 'B2' }, [el('text', {}, [txt('Floating note')])])])]),
          ],
        },
      },
    );
    expect(cells.find((cell) => cell.row === 1 && cell.column === 1)).toEqual({
      row: 1,
      column: 1,
      value: { kind: 'empty' },
      displayText: '',
      comment: { text: 'Floating note' },
    });
  });
});

describe('readXlsxContent: cell comments -- threaded comments ([MS-XLSX], synthetic packages)', () => {
  it("reads an Excel-365 thread in Excel's unprefixed spelling: persons-part display names, dT carried verbatim, replies flattened in document order", () => {
    // The persons part stores ids bare and lower case while the thread's personIds are braced and upper case -- the normalisation both sides of the lookup need to meet.
    const cells = readCommentedCells(
      [
        el('Relationship', { Id: 'rId1', Type: REL_THREADED_COMMENTS, Target: '../threadedComments/threadedComment1.xml' }),
        el('Relationship', { Id: 'rId2', Type: REL_PERSON, Target: '../persons/person1.xml' }),
      ],
      {
        'xl/threadedComments/threadedComment1.xml': {
          kind: 'xml',
          nodes: [
            el('ThreadedComments', {}, [
              el('threadedComment', { ref: 'A1', dT: '2026-08-17T09:30:00.000', personId: '{4A6B5D62-8EC5-4C85-BC1F-7B9E2A25C111}', id: 'tc-root' }, [el('text', {}, [txt('Thread root')])]),
              el('threadedComment', { ref: 'A1', dT: '2026-08-17T10:00:00.000', personId: '{4A6B5D62-8EC5-4C85-BC1F-7B9E2A25C222}', id: 'tc-reply-1', parentId: 'tc-root' }, [el('text', {}, [txt('First reply')])]),
              el('threadedComment', { ref: 'A1', dT: '2026-08-17T10:05:00.000', personId: '{00000000-0000-0000-0000-000000000000}', id: 'tc-reply-2', parentId: 'tc-root' }, [el('text', {}, [txt('Second reply')])]),
            ]),
          ],
        },
        'xl/persons/person1.xml': {
          kind: 'xml',
          nodes: [
            el('personList', {}, [
              el('person', { displayName: 'Joseph Mearman', id: '4a6b5d62-8ec5-4c85-bc1f-7b9e2a25c111', userId: 'joseph@mearman.co.uk', providerId: 'None' }),
              el('person', { displayName: 'Sarah Smith', id: '4a6b5d62-8ec5-4c85-bc1f-7b9e2a25c222', userId: 'sarah@example.com', providerId: 'None' }),
            ]),
          ],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({
      text: 'Thread root',
      author: 'Joseph Mearman',
      createdAt: '2026-08-17T09:30:00.000',
      replies: [
        { text: 'First reply', author: 'Sarah Smith' },
        { text: 'Second reply' }, // a personId the persons part does not name leaves that reply's author honestly unset
      ],
    });
    expect(findCell(cells, 0, 1).comment).toBeUndefined();
  });

  it("reads the older prefixed vocabulary real 2018-2021 producers wrote (dCreation/displayName/parent/dId), matching threadedComment children by local name and converting epoch-millisecond dCreation to ISO", () => {
    const cells = readCommentedCells(
      [el('Relationship', { Id: 'rId1', Type: REL_THREADED_COMMENTS, Target: '../threadedComments/threadedComment1.xml' })],
      {
        'xl/threadedComments/threadedComment1.xml': {
          kind: 'xml',
          nodes: [
            el('tc:ThreadedComments', {}, [
              el('tc:threadedComment', { ref: 'A1', dCreation: '1755425400000', displayName: 'Joseph Mearman', dId: 'root' }, [el('tc:text', {}, [txt('Old-vocabulary root')])]),
              el('tc:threadedComment', { ref: 'A1', dCreation: '0', displayName: 'Sarah Smith', dId: 'reply', parent: 'root' }, [el('tc:text', {}, [txt('Old-vocabulary reply')])]),
            ]),
          ],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({
      text: 'Old-vocabulary root',
      author: 'Joseph Mearman',
      createdAt: '2025-08-17T10:10:00.000Z',
      replies: [{ text: 'Old-vocabulary reply', author: 'Sarah Smith' }],
    });
  });

  it('reads a cell carrying BOTH a legacy note and a thread as the thread -- the strictly richer mechanism, and the one Excel 365 writes the legacy copy of every thread for down-level readers to see', () => {
    const cells = readCommentedCells(
      [
        el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments1.xml' }),
        el('Relationship', { Id: 'rId2', Type: REL_THREADED_COMMENTS, Target: '../threadedComments/threadedComment1.xml' }),
      ],
      {
        'xl/comments1.xml': {
          kind: 'xml',
          nodes: [
            el('comments', {}, [el('commentList', {}, [el('comment', { ref: 'A1' }, [el('text', {}, [txt('Legacy flattened copy of the thread')])])])]),
          ],
        },
        'xl/threadedComments/threadedComment1.xml': {
          kind: 'xml',
          nodes: [
            el('ThreadedComments', {}, [
              el('threadedComment', { ref: 'A1', dT: '2026-08-17T09:30:00.000', id: 'tc-root' }, [el('text', {}, [txt('Thread root')])]),
              el('threadedComment', { ref: 'A1', dT: '2026-08-17T10:00:00.000', id: 'tc-reply', parentId: 'tc-root' }, [el('text', {}, [txt('Reply')])]),
            ]),
          ],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({ text: 'Thread root', createdAt: '2026-08-17T09:30:00.000', replies: [{ text: 'Reply' }] });
  });
});

describe('readXlsxContent: cell comments -- part resolution and tolerance boundaries (synthetic packages)', () => {
  it('resolves comment parts through the worksheet rels, never by part name: a canonical-looking xl/comments1.xml no rel points at stays unread', () => {
    const cells = readCommentedCells(
      [el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments2.xml' })],
      {
        'xl/comments1.xml': {
          kind: 'xml',
          nodes: [el('comments', {}, [el('commentList', {}, [el('comment', { ref: 'B2' }, [el('text', {}, [txt('Decoy')])])])])],
        },
        'xl/comments2.xml': {
          kind: 'xml',
          nodes: [el('comments', {}, [el('commentList', {}, [el('comment', { ref: 'A1' }, [el('text', {}, [txt('Real note')])])])])],
        },
      },
    );
    expect(findCell(cells, 0, 0).comment).toEqual({ text: 'Real note' });
    // the decoy's B2 note would otherwise have materialised a cell of its own
    expect(cells.find((cell) => cell.row === 1 && cell.column === 1)).toBeUndefined();
  });

  it('reads no comments when the worksheet part has no .rels of its own, even with a comment part sitting in the package', () => {
    const cells = readCommentedCells([], {
      'xl/comments1.xml': {
        kind: 'xml',
        nodes: [el('comments', {}, [el('commentList', {}, [el('comment', { ref: 'A1' }, [el('text', {}, [txt('Unreachable')])])])])],
      },
    });
    expect(findCell(cells, 0, 0).comment).toBeUndefined();
    expect(cells).toHaveLength(2);
  });

  it('skips comment relationships whose target part is missing or binary rather than failing the sheet', () => {
    const cells = readCommentedCells(
      [
        el('Relationship', { Id: 'rId1', Type: REL_COMMENTS, Target: '../comments-gone.xml' }),
        el('Relationship', { Id: 'rId2', Type: REL_THREADED_COMMENTS, Target: '../threadedComments/not-xml' }),
      ],
      { 'xl/threadedComments/not-xml': { kind: 'binary', base64: 'AAAA' } },
    );
    expect(cells).toHaveLength(2);
    expect(findCell(cells, 0, 0).comment).toBeUndefined();
  });
});
