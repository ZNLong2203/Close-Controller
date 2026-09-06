/**
 * The only place in the import flow that writes.
 *
 * Everything upstream is pure — parse, guess, transform, preview — so the user
 * can change their mind about the mapping as many times as they like without a
 * row ever reaching the database. This function is the confirm step, and it
 * records what it did in `audit_event` before it returns.
 */
import { db, id, nowIso } from "../db";
import { audit } from "../audit";
import type { BankDraft, GlDraft } from "./transform";

export interface IngestSide<T> {
  rows: T[];
  /** Original filename, so the audit trail can name the file a row came from. */
  source: string;
  rejectedCount: number;
}

export interface IngestInput {
  bank?: IngestSide<BankDraft> | null;
  ledger?: IngestSide<GlDraft> | null;
  /** Clear the existing dataset first. Off means append to what is already there. */
  replaceExisting: boolean;
  /** Bare username; the audit trail prefixes it with `human:`. */
  actor: string;
}

export interface IngestResult {
  batchId: string;
  bankInserted: number;
  glInserted: number;
  cleared: Record<string, number> | null;
  period: string | null;
}

/**
 * Derived state first, then the source rows it points at. `exception` holds
 * foreign keys onto both source tables, so nothing can be deleted out of order
 * with `foreign_keys = ON`.
 */
const CLEAR_ORDER = [
  "policy_violation",
  "journal_line",
  "journal_entry",
  "exception",
  "match_line",
  "match",
  "goods_receipt",
  "purchase_order",
  "invoice",
  "ground_truth",
] as const;

function clearDataset(): Record<string, number> {
  const d = db();
  const cleared: Record<string, number> = {};
  for (const t of CLEAR_ORDER) {
    cleared[t] = d.prepare(`DELETE FROM "${t}"`).run().changes;
  }
  // Run-scoped audit rows go with their run; import records, which carry no
  // run, survive so the history of what was loaded stays intact.
  cleared.audit_event = d.prepare(`DELETE FROM audit_event WHERE run_id IS NOT NULL`).run().changes;
  cleared.run = d.prepare(`DELETE FROM run`).run().changes;
  cleared.bank_txn = d.prepare(`DELETE FROM bank_txn`).run().changes;
  cleared.gl_entry = d.prepare(`DELETE FROM gl_entry`).run().changes;
  return cleared;
}

export function ingest(input: IngestInput): IngestResult {
  const d = db();
  const batchId = id("imp");
  const bankRows = input.bank?.rows ?? [];
  const glRows = input.ledger?.rows ?? [];

  const insBank = d.prepare(
    `INSERT INTO bank_txn (id, posted_on, amount_cents, currency, description, counterparty, external_ref, raw_json)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const insGl = d.prepare(
    `INSERT INTO gl_entry (id, booked_on, amount_cents, currency, account_code, memo, vendor, doc_type, doc_ref, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  let cleared: Record<string, number> | null = null;

  d.transaction(() => {
    if (input.replaceExisting) cleared = clearDataset();

    bankRows.forEach((r, i) => {
      insBank.run(
        `btx_${batchId.slice(4)}_${String(i + 1).padStart(4, "0")}`,
        r.posted_on, r.amount_cents, r.currency, r.description,
        r.counterparty, r.external_ref, JSON.stringify(r.raw)
      );
    });
    glRows.forEach((r, i) => {
      insGl.run(
        `gle_${batchId.slice(4)}_${String(i + 1).padStart(4, "0")}`,
        r.booked_on, r.amount_cents, r.currency, r.account_code, r.memo,
        r.vendor, null, r.doc_ref, JSON.stringify(r.raw)
      );
    });
  })();

  if (cleared) {
    audit({
      actor: `human:${input.actor}`,
      action: "import.dataset_replaced",
      entityType: "import",
      entityId: batchId,
      detail: { cleared },
    });
  }

  const dates = [...bankRows.map((r) => r.posted_on), ...glRows.map((r) => r.booked_on)].sort();
  audit({
    actor: `human:${input.actor}`,
    action: "import.completed",
    entityType: "import",
    entityId: batchId,
    detail: {
      at: nowIso(),
      replaceExisting: input.replaceExisting,
      bank: input.bank
        ? { source: input.bank.source, inserted: bankRows.length, rejected: input.bank.rejectedCount }
        : null,
      ledger: input.ledger
        ? { source: input.ledger.source, inserted: glRows.length, rejected: input.ledger.rejectedCount }
        : null,
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
    },
  });

  return {
    batchId,
    bankInserted: bankRows.length,
    glInserted: glRows.length,
    cleared,
    period: dates.length ? dates[Math.floor(dates.length / 2)].slice(0, 7) : null,
  };
}

export interface ImportLogRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity_id: string | null;
  detail_json: string | null;
}

/** Recent imports, straight off the audit table — the same rows an export would carry. */
export const recentImports = (limit = 8): ImportLogRow[] =>
  db()
    .prepare(
      `SELECT id, ts, actor, action, entity_id, detail_json FROM audit_event
        WHERE action = 'import.completed' ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as ImportLogRow[];
