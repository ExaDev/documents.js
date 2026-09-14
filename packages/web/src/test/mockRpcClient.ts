import type { RouterClient } from "@orpc/server";
import { vi } from "vitest";

import type { AppRouter } from "../rpc/router";

// A full structural stand-in for getRpcClient()'s return value, one vi.fn() per procedure the real router (src/rpc/router.ts) exposes -- every hook test replaces getRpcClient with a function returning one of these, then overrides only the procedure(s) it actually calls via mockResolvedValue/mockImplementation. vi.fn()'s own type can't be verified against oRPC's generic per-procedure call signature (input, plus an options object carrying signal), so the return is cast at the one point where the object's shape is assembled, not scattered per test.
export function createMockRpcClient(): RouterClient<AppRouter> {
  return {
    formats: {
      list: vi.fn(),
      listConversions: vi.fn(),
    },
    convert: vi.fn(),
    content: {
      read: vi.fn(),
      restore: vi.fn(),
    },
    odb: {
      read: vi.fn(),
    },
    metadata: {
      read: vi.fn(),
      write: vi.fn(),
    },
    fonts: {
      describe: vi.fn(),
      extractSourceFonts: vi.fn(),
    },
    pdf: {
      inspect: vi.fn(),
    },
    odm: {
      render: vi.fn(),
    },
    editor: {
      open: vi.fn(),
      setParagraphText: vi.fn(),
      addParagraph: vi.fn(),
      removeParagraph: vi.fn(),
      save: vi.fn(),
    },
  };
}
