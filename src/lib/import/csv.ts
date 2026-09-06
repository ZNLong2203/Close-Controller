/**
 * A small RFC 4180 reader.
 *
 * Hand-rolled rather than pulled in as a dependency, because the failure mode we
 * care about is a *rejected row*: when the flow refuses a line, we have to be
 * able to say exactly which byte offended it. Bank exports arrive with BOMs,
 * CRLF endings, semicolon delimiters and quoted fields containing commas, and
 * all four have to survive the same code path.
 */

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

export interface ParsedCsv {
  /** Header labels, trimmed. Blank headers become `Column N` so they stay selectable. */
  headers: string[];
  /** Data rows only. Short rows are left short; the transform treats a missing cell as empty. */
  rows: string[][];
  delimiter: string;
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** The first physical line, respecting quotes so a quoted newline cannot truncate it. */
function headerLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (c === "\n" || c === "\r")) return text.slice(0, i);
  }
  return text;
}

export function detectDelimiter(text: string): string {
  const line = headerLine(stripBom(text));
  let best = ",";
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && c === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const src = stripBom(text);
  const delim = delimiter ?? detectDelimiter(src);

  const grid: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let dirty = false; // this row has seen at least one character or delimiter

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A line of nothing but delimiters is padding, not data.
    if (dirty && row.some((c) => c.trim() !== "")) grid.push(row);
    row = [];
    dirty = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      dirty = true;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      dirty = true;
      continue;
    }
    if (c === delim) {
      endField();
      dirty = true;
      continue;
    }
    if (c === "\r") {
      if (src[i + 1] === "\n") i++;
      endRow();
      continue;
    }
    if (c === "\n") {
      endRow();
      continue;
    }
    field += c;
    dirty = true;
  }
  if (dirty || field !== "") endRow();

  if (!grid.length) return { headers: [], rows: [], delimiter: delim };

  const headers = grid[0].map((h, i) => {
    const t = h.trim();
    return t === "" ? `Column ${i + 1}` : t;
  });
  return { headers, rows: grid.slice(1), delimiter: delim };
}

/** Header text reduced to a comparable key: `Transaction Date ` -> `transactiondate`. */
export const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export const cell = (row: string[], index: number | null): string =>
  index === null || index < 0 ? "" : (row[index] ?? "").trim();
