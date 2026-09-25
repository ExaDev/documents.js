import { unzipSync, zipSync, type Zippable, type ZipOptions } from "fflate";

// fflate is synchronous, isomorphic, and dependency-free.
export function unzipPackage(
  bytes: Uint8Array<ArrayBuffer>,
): Record<string, Uint8Array<ArrayBuffer>> {
  return unzipSync(bytes);
}

// The fixed entry timestamp's own calendar fields: fflate's own DOS-date floor year, mid-year month/day, and noon UTC (both zero fields below are minutes and seconds, both zero), per this constant's own comment.
const FIXED_ENTRY_MTIME_YEAR = 1980;
const FIXED_ENTRY_MTIME_MONTH_INDEX = 5; // June, 0-indexed
const FIXED_ENTRY_MTIME_DAY = 15;
const FIXED_ENTRY_MTIME_HOUR_UTC = 12; // noon

// The fixed entry timestamp every written zip carries. fflate's default mtime is the wall clock, which would make two serialisations of the same parts differ in bytes whenever they straddle a 2-second DOS-timestamp boundary — and byte-identical output for identical input is a load-bearing invariant here, not polish: the docx writer deduplicates copy-pasted embedded objects by comparing their serialised payloads, so a wall-clock timestamp leaking into those bytes silently splits one shared embeddings part into duplicates. These are freshly built packages, never restorations of a producer's own archive, so no real timestamp is lost by pinning one. Deliberately NOT the DOS-date floor itself (1980-01-01T00:00:00Z): fflate's own DOS-date encoding (wzh) reads a Date through its *local*, not UTC, calendar getters, so a value sitting exactly on that floor rolls back into 1979 — one year below fflate's own accepted range — under any reading process whose local zone has a negative UTC offset at that instant (confirmed for America/New_York today, and for Pacific/Kiritimati before its 1995 date-line move, when it was UTC-10:40 rather than its current UTC+14). Noon UTC in the middle of the year gives comfortable margin against every real IANA zone's offset, past or present, in either direction.
export const FIXED_ENTRY_MTIME = new Date(
  Date.UTC(
    FIXED_ENTRY_MTIME_YEAR,
    FIXED_ENTRY_MTIME_MONTH_INDEX,
    FIXED_ENTRY_MTIME_DAY,
    FIXED_ENTRY_MTIME_HOUR_UTC,
    0,
    0,
  ),
);

export function zipPackage(
  parts: Record<string, Uint8Array<ArrayBuffer>>,
): Uint8Array<ArrayBuffer> {
  const data: Zippable = {};
  for (const [path, bytes] of Object.entries(parts)) {
    const options: ZipOptions = { mtime: FIXED_ENTRY_MTIME };
    data[path] = [bytes, options];
  }
  return zipSync(data);
}
