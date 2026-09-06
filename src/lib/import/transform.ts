/**
 * Mapping + parsed CSV -> rows ready for `bank_txn` / `gl_entry`.
 *
 * The contract is that a row either arrives fully understood or it does not
 * arrive. A date or an amount this module cannot read to the cent produces a
 * `RejectedRow` carrying the line number and the reason, and the user sees that
 * list before anything is written. Silently coercing bad financial data is a
 * worse outcome than refusing it, because the coercion is invisible afterwards
 * and the refusal is not.
 */
import { cell, type ParsedCsv } from "./csv";
import { modalPeriod, parseDateIso, resolveOrder, detectDateOrder, type ResolvedOrder } from "./dates";
import { applyMarker, parseMoneyCents } from "./money";
import { appliesUnder, type ColumnMapping, type ImportKind } from "./mapping";

export interface BankDraft {
  posted_on: string;
  amount_cents: number;
  currency: string;
  description: string;
  counterparty: string | null;
  external_ref: string | null;
  raw: Record<string, string>;
}

export interface GlDraft {
  booked_on: string;
  amount_cents: number;
  currency: string;
  account_code: string;
  memo: string;
  vendor: string | null;
  doc_ref: string | null;
  raw: Record<string, string>;
}

export type Draft = BankDraft | GlDraft;

export interface RejectedRow {
  /** 1-based line in the original file, header counted. */
  line: number;
  reason: string;
  cells: string[];
}

export interface TransformResult<T extends Draft> {
  kind: ImportKind;
  rows: T[];
  rejected: RejectedRow[];
  warnings: string[];
  dateFrom: string | null;
  dateTo: string | null;
  /** The month most of the rows land in — what a close should be run for. */
  period: string | null;
  netCents: number;
  resolvedDateOrder: ResolvedOrder;
}

/** No account column is a survivable gap, but never an invisible one. */
export const FALLBACK_ACCOUNT = "0000";
const DEFAULT_CURRENCY = "USD";
const NO_TEXT = "(no description)";

interface AmountOk {
  ok: true;
  cents: number;
  bothSides: boolean;
}
interface AmountErr {
  ok: false;
  reason: string;
}

function amountFor(row: string[], mapping: ColumnMapping): AmountOk | AmountErr {
  if (mapping.amountMode === "signed") {
    const raw = cell(row, mapping.columns.amount ?? null);
    const m = parseMoneyCents(raw);
    if (!m.ok) return { ok: false, reason: `amount: ${m.reason}` };
    return { ok: true, cents: applyMarker(m), bothSides: false };
  }

  const debitRaw = cell(row, mapping.columns.debit ?? null);
  const creditRaw = cell(row, mapping.columns.credit ?? null);
  if (!debitRaw && !creditRaw) return { ok: false, reason: "amount: both the debit and credit columns are blank" };

  let debit = 0;
  let credit = 0;
  if (debitRaw) {
    const m = parseMoneyCents(debitRaw);
    if (!m.ok) return { ok: false, reason: `debit: ${m.reason}` };
    debit = m.cents;
  }
  if (creditRaw) {
    const m = parseMoneyCents(creditRaw);
    if (!m.ok) return { ok: false, reason: `credit: ${m.reason}` };
    credit = m.cents;
  }
  // Money out is negative on both sides of the house, which is what lets the
  // matcher compare a bank line to a ledger line without a sign convention flag.
  return { ok: true, cents: credit - debit, bothSides: debit !== 0 && credit !== 0 };
}

function currencyFor(row: string[], mapping: ColumnMapping): { code: string; odd: boolean } {
  const raw = cell(row, mapping.columns.currency ?? null);
  if (!raw) return { code: DEFAULT_CURRENCY, odd: false };
  const up = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(up)) return { code: up, odd: false };
  return { code: DEFAULT_CURRENCY, odd: true };
}

const blank = (s: string) => (s === "" ? null : s);

interface Accum {
  rejected: RejectedRow[];
  dates: string[];
  net: number;
  bothSides: number;
  oddCurrency: number;
  blankText: number;
}

function dateSamples(parsed: ParsedCsv, mapping: ColumnMapping): string[] {
  const col = mapping.columns.date ?? null;
  if (col === null) return [];
  return parsed.rows.map((r) => cell(r, col));
}

function finish<T extends Draft>(
  kind: ImportKind,
  rows: T[],
  acc: Accum,
  mapping: ColumnMapping,
  order: ResolvedOrder,
  samples: string[]
): TransformResult<T> {
  const warnings: string[] = [];

  if (mapping.dateOrder === "auto") {
    const det = detectDateOrder(samples);
    if (det.ambiguous && samples.some((s) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s.trim()))) {
      warnings.push(
        det.dmyEvidence > 0 && det.mdyEvidence > 0
          ? `The date column is internally inconsistent — ${det.dmyEvidence} rows only read as DD/MM and ${det.mdyEvidence} only as MM/DD. Assuming ${order === "dmy" ? "DD/MM" : "MM/DD"}; set "Date format" explicitly if that is wrong.`
          : `Every date in this column reads equally well as DD/MM and MM/DD. Assuming MM/DD — set "Date format" explicitly if these are day-first.`
      );
    }
  }
  if (kind === "ledger" && (mapping.columns.account ?? null) === null) {
    warnings.push(`No account column is mapped, so every ledger line will be booked to account ${FALLBACK_ACCOUNT}.`);
  }
  if (acc.bothSides) {
    warnings.push(`${acc.bothSides} row(s) carry a value in both the debit and the credit column; the net of the two was taken.`);
  }
  if (acc.oddCurrency) {
    warnings.push(`${acc.oddCurrency} row(s) have a currency this importer does not recognise as a 3-letter code; they default to ${DEFAULT_CURRENCY}.`);
  }
  if (acc.blankText) {
    warnings.push(`${acc.blankText} row(s) have no ${kind === "bank" ? "description" : "memo"}; they import as "${NO_TEXT}".`);
  }

  const sorted = [...acc.dates].sort();
  return {
    kind,
    rows,
    rejected: acc.rejected,
    warnings,
    dateFrom: sorted[0] ?? null,
    dateTo: sorted[sorted.length - 1] ?? null,
    period: modalPeriod(acc.dates),
    netCents: acc.net,
    resolvedDateOrder: order,
  };
}

function rawOf(headers: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((h, i) => {
    out[h] = (row[i] ?? "").trim();
  });
  return out;
}

export function transformBank(parsed: ParsedCsv, mapping: ColumnMapping): TransformResult<BankDraft> {
  const samples = dateSamples(parsed, mapping);
  const order = resolveOrder(mapping.dateOrder, samples);
  const acc: Accum = { rejected: [], dates: [], net: 0, bothSides: 0, oddCurrency: 0, blankText: 0 };
  const rows: BankDraft[] = [];

  parsed.rows.forEach((r, i) => {
    const line = i + 2;
    const d = parseDateIso(cell(r, mapping.columns.date ?? null), order);
    if (!d.ok) {
      acc.rejected.push({ line, reason: `date: ${d.reason}`, cells: r });
      return;
    }
    const a = amountFor(r, mapping);
    if (!a.ok) {
      acc.rejected.push({ line, reason: a.reason, cells: r });
      return;
    }
    if (a.bothSides) acc.bothSides++;

    const ccy = currencyFor(r, mapping);
    if (ccy.odd) acc.oddCurrency++;

    const counterparty = blank(cell(r, mapping.columns.counterparty ?? null));
    let description = cell(r, mapping.columns.description ?? null);
    if (!description) {
      description = counterparty ?? NO_TEXT;
      acc.blankText++;
    }

    acc.dates.push(d.iso);
    acc.net += a.cents;
    rows.push({
      posted_on: d.iso,
      amount_cents: a.cents,
      currency: ccy.code,
      description,
      counterparty,
      external_ref: blank(cell(r, mapping.columns.reference ?? null)),
      raw: rawOf(parsed.headers, r),
    });
  });

  return finish("bank", rows, acc, mapping, order, samples);
}

export function transformLedger(parsed: ParsedCsv, mapping: ColumnMapping): TransformResult<GlDraft> {
  const samples = dateSamples(parsed, mapping);
  const order = resolveOrder(mapping.dateOrder, samples);
  const acc: Accum = { rejected: [], dates: [], net: 0, bothSides: 0, oddCurrency: 0, blankText: 0 };
  const rows: GlDraft[] = [];

  parsed.rows.forEach((r, i) => {
    const line = i + 2;
    const d = parseDateIso(cell(r, mapping.columns.date ?? null), order);
    if (!d.ok) {
      acc.rejected.push({ line, reason: `date: ${d.reason}`, cells: r });
      return;
    }
    const a = amountFor(r, mapping);
    if (!a.ok) {
      acc.rejected.push({ line, reason: a.reason, cells: r });
      return;
    }
    if (a.bothSides) acc.bothSides++;

    const ccy = currencyFor(r, mapping);
    if (ccy.odd) acc.oddCurrency++;

    const vendor = blank(cell(r, mapping.columns.vendor ?? null));
    let memo = cell(r, mapping.columns.memo ?? null);
    if (!memo) {
      memo = vendor ?? NO_TEXT;
      acc.blankText++;
    }

    acc.dates.push(d.iso);
    acc.net += a.cents;
    rows.push({
      booked_on: d.iso,
      amount_cents: a.cents,
      currency: ccy.code,
      account_code: cell(r, mapping.columns.account ?? null) || FALLBACK_ACCOUNT,
      memo,
      vendor,
      doc_ref: blank(cell(r, mapping.columns.reference ?? null)),
      raw: rawOf(parsed.headers, r),
    });
  });

  return finish("ledger", rows, acc, mapping, order, samples);
}

export function transform(parsed: ParsedCsv, mapping: ColumnMapping, kind: ImportKind): TransformResult<Draft> {
  return kind === "bank" ? transformBank(parsed, mapping) : transformLedger(parsed, mapping);
}

/** Columns the mapping actually reads, for the preview header. */
export const activeFieldKeys = (mapping: ColumnMapping, kind: ImportKind): string[] =>
  (kind === "bank"
    ? ["date", "amount", "debit", "credit", "description", "counterparty", "reference", "currency"]
    : ["date", "amount", "debit", "credit", "account", "memo", "vendor", "reference", "currency"]
  ).filter((k) => appliesUnder(k, mapping.amountMode));
