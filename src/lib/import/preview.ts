/**
 * The serialisable shape the wizard renders, built by the same code path the
 * commit uses. The preview is only honest if it is the same transform — a
 * preview produced by a second implementation is a demo, not a check.
 */
import { z } from "zod";
import { parseCsv } from "./csv";
import { guessMapping, missingRequired, type ColumnMapping, type ImportKind } from "./mapping";
import { formatCents } from "./money";
import { transform, type BankDraft, type Draft, type GlDraft, type RejectedRow, type TransformResult } from "./transform";

export const MAX_CSV_BYTES = 8 * 1024 * 1024;

export const KindSchema = z.enum(["bank", "ledger"]);

export const MappingSchema = z.object({
  columns: z.record(z.union([z.number().int().min(0), z.null()])),
  amountMode: z.enum(["signed", "debit_credit"]),
  dateOrder: z.enum(["auto", "mdy", "dmy"]),
});

export const CsvSchema = z.string().min(1).max(MAX_CSV_BYTES);

export const isBank = (d: Draft): d is BankDraft => "posted_on" in d;

export interface PreviewRow {
  date: string;
  amountCents: number;
  amount: string;
  currency: string;
  primary: string;
  secondary: string | null;
  account: string | null;
  reference: string | null;
}

export interface PreviewPayload {
  kind: ImportKind;
  headers: string[];
  delimiter: string;
  /** Every data row the file contains, accepted or not. */
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  /** First 10, exactly as they would be inserted. */
  sample: PreviewRow[];
  /** Capped: a file where every row fails does not need 4,000 identical reasons. */
  rejected: RejectedRow[];
  warnings: string[];
  missing: string[];
  dateFrom: string | null;
  dateTo: string | null;
  period: string | null;
  net: string;
}

const REJECTED_SHOWN = 25;

export function toPreviewRow(d: Draft): PreviewRow {
  if (isBank(d)) {
    return {
      date: d.posted_on,
      amountCents: d.amount_cents,
      amount: formatCents(d.amount_cents),
      currency: d.currency,
      primary: d.description,
      secondary: d.counterparty,
      account: null,
      reference: d.external_ref,
    };
  }
  const g = d as GlDraft;
  return {
    date: g.booked_on,
    amountCents: g.amount_cents,
    amount: formatCents(g.amount_cents),
    currency: g.currency,
    primary: g.memo,
    secondary: g.vendor,
    account: g.account_code,
    reference: g.doc_ref,
  };
}

export function buildPreview(csv: string, mapping: ColumnMapping, kind: ImportKind) {
  const parsed = parseCsv(csv);
  const result = transform(parsed, mapping, kind) as TransformResult<Draft>;
  const missing = missingRequired(mapping, kind);

  const payload: PreviewPayload = {
    kind,
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    totalRows: parsed.rows.length,
    acceptedRows: result.rows.length,
    rejectedRows: result.rejected.length,
    sample: result.rows.slice(0, 10).map(toPreviewRow),
    rejected: result.rejected.slice(0, REJECTED_SHOWN),
    warnings: result.warnings,
    missing: missing.map((f) => f.label),
    dateFrom: result.dateFrom,
    dateTo: result.dateTo,
    period: result.period,
    net: formatCents(result.netCents),
  };
  return { parsed, result, payload };
}

/** Headers + a first guess. Nothing is transformed yet. */
export function inspect(csv: string, kind: ImportKind) {
  const parsed = parseCsv(csv);
  const mapping = guessMapping(parsed.headers, kind);
  return {
    headers: parsed.headers,
    delimiter: parsed.delimiter,
    rowCount: parsed.rows.length,
    mapping,
    sampleRows: parsed.rows.slice(0, 5),
  };
}
