/**
 * Text -> `YYYY-MM-DD`.
 *
 * The hard part is not the formats, it is `03/04/2026`. Rather than pick a
 * locale and hope, the column is scanned as a whole: a single row with a first
 * component above 12 settles the question for every other row. When nothing in
 * the column settles it, that fact is surfaced to the user before anything is
 * written, and they can override it from the mapping screen.
 */

export type DateOrder = "auto" | "mdy" | "dmy";
export type ResolvedOrder = "mdy" | "dmy";

export interface DateOk {
  ok: true;
  iso: string;
}
export interface DateErr {
  ok: false;
  reason: string;
}
export type DateResult = DateOk | DateErr;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const NUMERIC_YMD = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/;
const NUMERIC_AMBIGUOUS = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/;
const DAY_MONTH_NAME = /^(\d{1,2})[-\s.]+([A-Za-z]{3,9})\.?[-\s,]+(\d{2}|\d{4})$/;
const MONTH_NAME_DAY = /^([A-Za-z]{3,9})\.?[-\s]+(\d{1,2})(?:st|nd|rd|th)?,?[-\s]+(\d{2}|\d{4})$/;
const COMPACT = /^(\d{8})$/;

/** Trailing clock time is noise for a posting date; drop it rather than reject the row. */
const TIME_TAIL = /[T\s]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:[AaPp]\.?[Mm]\.?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/;

const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Two-digit years: the pivot the rest of finance uses. */
const expandYear = (raw: string) => (raw.length === 4 ? Number(raw) : Number(raw) < 70 ? 2000 + Number(raw) : 1900 + Number(raw));

function build(y: number, m: number, d: number, input: string): DateResult {
  if (m < 1 || m > 12) return { ok: false, reason: `"${input}" has month ${m}` };
  if (y < 1900 || y > 2199) return { ok: false, reason: `"${input}" has year ${y}` };
  if (d < 1 || d > daysInMonth(y, m)) return { ok: false, reason: `"${input}" is not a real calendar date` };
  return { ok: true, iso: `${y}-${pad(m)}-${pad(d)}` };
}

export function parseDateIso(raw: string | undefined | null, order: ResolvedOrder = "mdy"): DateResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, reason: "date is blank" };

  const s = input.replace(TIME_TAIL, "").trim();

  let m = s.match(NUMERIC_YMD);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]), input);

  m = s.match(NUMERIC_AMBIGUOUS);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(m[3]);
    // A component above 12 can only be a day, whatever the declared order says.
    if (a > 12 && b <= 12) return build(y, b, a, input);
    if (b > 12 && a <= 12) return build(y, a, b, input);
    return order === "dmy" ? build(y, b, a, input) : build(y, a, b, input);
  }

  m = s.match(DAY_MONTH_NAME);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return { ok: false, reason: `"${input}" has an unrecognised month name` };
    return build(expandYear(m[3]), mo, Number(m[1]), input);
  }

  m = s.match(MONTH_NAME_DAY);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return { ok: false, reason: `"${input}" has an unrecognised month name` };
    return build(expandYear(m[3]), mo, Number(m[2]), input);
  }

  m = s.match(COMPACT);
  if (m) return build(Number(m[1].slice(0, 4)), Number(m[1].slice(4, 6)), Number(m[1].slice(6, 8)), input);

  return { ok: false, reason: `"${input}" is not a date this importer recognises` };
}

export interface OrderDetection {
  order: ResolvedOrder;
  /** True when every value in the column reads equally well as DD/MM and MM/DD. */
  ambiguous: boolean;
  /** Rows that only make sense day-first / month-first respectively. */
  dmyEvidence: number;
  mdyEvidence: number;
}

export function detectDateOrder(samples: (string | undefined)[]): OrderDetection {
  let dmy = 0;
  let mdy = 0;
  for (const raw of samples) {
    const s = (raw ?? "").trim().replace(TIME_TAIL, "").trim();
    const m = s.match(NUMERIC_AMBIGUOUS);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  // Contradictory evidence means the column is inconsistent, not that one side
  // won: report it as ambiguous so the user is asked rather than guessed at.
  const ambiguous = (dmy === 0 && mdy === 0) || (dmy > 0 && mdy > 0);
  return { order: dmy > mdy ? "dmy" : "mdy", ambiguous, dmyEvidence: dmy, mdyEvidence: mdy };
}

export const resolveOrder = (chosen: DateOrder, samples: (string | undefined)[]): ResolvedOrder =>
  chosen === "auto" ? detectDateOrder(samples).order : chosen;

/** `YYYY-MM` of the month holding the most rows — the period a close should run for. */
export function modalPeriod(isoDates: string[]): string | null {
  const counts = new Map<string, number>();
  for (const d of isoDates) {
    const p = d.slice(0, 7);
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [p, c] of counts) {
    if (c > bestCount) {
      best = p;
      bestCount = c;
    }
  }
  return best;
}
