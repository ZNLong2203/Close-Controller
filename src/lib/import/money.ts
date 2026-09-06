/**
 * Text -> integer cents.
 *
 * `parseFloat` is never used here and never should be: `parseFloat("1,234.56")`
 * is 1, silently, and a reconciliation engine that is out by three orders of
 * magnitude on one row is worse than one that refused the file. Everything below
 * works on digit strings and integer arithmetic, and anything it cannot read to
 * the cent is returned as a rejection with a reason a human can act on.
 */

/** `DR` = money out, `CR` = money in. Only meaningful on a single signed column. */
export type DrCrMarker = "dr" | "cr" | null;

export interface MoneyOk {
  ok: true;
  /**
   * Sign carries only what the *number* said — a leading/trailing minus or
   * accounting parentheses. The DR/CR marker is reported separately so a
   * debit/credit column pair, where the column already declares the direction,
   * does not apply the same sign twice.
   */
  cents: number;
  marker: DrCrMarker;
}
export interface MoneyErr {
  ok: false;
  reason: string;
}
export type MoneyResult = MoneyOk | MoneyErr;

const ISO_CURRENCY = /\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|CNY|SEK|NOK|DKK|PLN|INR|SGD|HKD|NZD|ZAR|MXN|BRL|AED)\b/gi;

export function parseMoneyCents(raw: string | undefined | null): MoneyResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, reason: "amount is blank" };

  let s = input;
  let sign = 1;

  // (1,234.56) — accounting negative.
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1).trim();
  }

  // A DR/CR marker at either end, before the currency scrub eats the letters.
  let marker: DrCrMarker = null;
  const trailing = s.match(/^(.*?)\s*(DR|CR)\.?$/i);
  const leading = s.match(/^(DR|CR)\.?\s*(.+)$/i);
  if (trailing) {
    marker = trailing[2].toLowerCase() as DrCrMarker;
    s = trailing[1].trim();
  } else if (leading) {
    marker = leading[1].toLowerCase() as DrCrMarker;
    s = leading[2].trim();
  }

  s = s
    .replace(ISO_CURRENCY, "")
    .replace(/[\p{Sc}]/gu, "") // $ € £ ¥ …
    .replace(/[\s ]/g, "")
    .replace(/[−–—]/g, "-"); // unicode minus / dashes

  // Sign can sit on either end; SAP-style exports put it on the right.
  if (s.startsWith("-")) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    sign = -sign;
    s = s.slice(0, -1);
  }

  if (!/^\d+(?:[.,]\d+)*$/.test(s)) {
    return { ok: false, reason: `"${input}" is not a number` };
  }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let frac = "";

  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators present: the rightmost one is the decimal point, whichever
    // it is. That covers 1,234.56 and 1.234,56 without having to know the locale.
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec).replace(/[.,]/g, "");
    frac = s.slice(dec + 1);
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    // Repeated, or a comma with exactly three digits behind it, means grouping:
    // "1,234" is one thousand two hundred and thirty four in every export we
    // have met. "1.234" is left as three decimals and therefore rejected below,
    // which is the honest answer to a genuinely ambiguous value.
    const grouping = parts.length > 2 || (sep === "," && tail.length === 3);
    if (grouping) {
      intPart = parts.join("");
    } else {
      intPart = parts.slice(0, -1).join("");
      frac = tail;
    }
  } else {
    intPart = s;
  }

  if (frac.length > 2) {
    return {
      ok: false,
      reason: `"${input}" carries ${frac.length} decimal places; money is stored to the cent and rounding it here would be a silent edit`,
    };
  }
  if (intPart.length > 14) {
    return { ok: false, reason: `"${input}" is too large to hold exactly in cents` };
  }

  const cents = Number(intPart || "0") * 100 + Number(`${frac}00`.slice(0, 2));
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, reason: `"${input}" is outside the exactly-representable range` };
  }
  return { ok: true, cents: sign * cents, marker };
}

/** Apply a DR/CR marker to a single signed column. `DR` is money out. */
export function applyMarker(m: MoneyOk): number {
  if (m.marker === "dr") return -Math.abs(m.cents);
  if (m.marker === "cr") return Math.abs(m.cents);
  return m.cents;
}

export const formatCents = (c: number): string => {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.trunc(abs / 100).toLocaleString("en-US");
  return `${neg ? "-" : ""}${whole}.${String(abs % 100).padStart(2, "0")}`;
};
