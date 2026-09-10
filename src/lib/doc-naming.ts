// Pure helpers for turning an uploaded file's name into a sensible entry title/date — used when a
// minutes or status-update document creates its Minutes / Status update entry.

const EXT_RE = /\.[a-z0-9]{1,5}$/i;
const VERSION_RE = /\s*[-_ ]?\bv\d+(\.\d+)*\b\s*$/i;

/** "BEKO- Meeting Minute 2026.09.10 v1.0.pdf" → "BEKO- Meeting Minute 2026.09.10" */
export function titleFromFileName(name: string): string {
  const base = name.replace(EXT_RE, "").trim();
  const noVersion = base.replace(VERSION_RE, "").trim();
  return (noVersion || base || "Untitled").slice(0, 200);
}

/** First date-looking token in the name: 2026.09.10 / 2026-09-10 / 2026_09_10 / 20260910 / 10.09.2026 / 10-09-2026.
 *  Returns a UTC-midnight Date, or null when nothing plausible is found. */
export function dateFromFileName(name: string): Date | null {
  const ymd = name.match(/(20\d{2})[.\-_/ ]?(0[1-9]|1[0-2])[.\-_/ ]?(0[1-9]|[12]\d|3[01])(?!\d)/);
  const dmy = name.match(/(?<!\d)(0[1-9]|[12]\d|3[01])[.\-_/](0[1-9]|1[0-2])[.\-_/](20\d{2})(?!\d)/);
  let y: number, m: number, d: number;
  if (ymd) { y = Number(ymd[1]); m = Number(ymd[2]); d = Number(ymd[3]); }
  else if (dmy) { d = Number(dmy[1]); m = Number(dmy[2]); y = Number(dmy[3]); }
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject impossible days (e.g. 31 Feb rolls over in JS).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}
