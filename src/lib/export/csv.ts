/**
 * CSV serialisation for the audit exports.
 *
 * An export an auditor cannot open is not audit support, so this follows
 * RFC 4180 to the letter: every field that could be misread is quoted, embedded
 * quotes are doubled, and rows end in CRLF. A leading BOM is emitted so Excel
 * reads the file as UTF-8 rather than mangling the separators the summaries use.
 */

export type Column<T> = { header: string; value: (row: T) => unknown };

const NEEDS_QUOTING = /[",\r\n]/;

/** One CSV field. Anything ambiguous — separators, quotes, edge whitespace — is quoted. */
export function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  if (s === "") return "";
  if (NEEDS_QUOTING.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvValue(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvValue(c.value(row))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Integer cents -> a decimal string, by integer arithmetic only. No float ever touches money. */
export function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Flattens one audit event's detail JSON into `path -> readable value` pairs.
 * Nested objects become dotted paths; arrays of objects become indexed paths;
 * arrays of scalars collapse into one semicolon-joined cell, because
 * `bankTxnIds` reads better as a list than as five columns.
 */
export function flattenDetail(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    if (prefix) out[prefix] = "";
    return out;
  }
  if (Array.isArray(value)) {
    // An empty array or object contributes no column: the union of keys across
    // events already leaves the cell blank wherever the field is absent.
    if (value.length === 0) {
      return out;
    } else if (value.every((v) => v === null || typeof v !== "object")) {
      out[prefix] = value.map((v) => (v === null ? "" : String(v))).join("; ");
    } else {
      value.forEach((v, i) => flattenDetail(v, `${prefix}[${i}]`, out));
    }
    return out;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return out;
    for (const [k, v] of entries) flattenDetail(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix] = String(value);
  return out;
}

/** Safe for a Content-Disposition filename and for every filesystem an auditor might use. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
