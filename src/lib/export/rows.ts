import { db } from "../db";

/**
 * Read models for the three audit exports.
 *
 * Kept beside the CSV writer rather than in the route handlers so the journal
 * screen and the journal export are guaranteed to show the same close. Nothing
 * here mutates; every function is a plain projection of one run.
 */

export interface RunRef {
  id: string;
  period: string;
  startedAt: string;
}

/** Resolves `?run=` — or falls back to the most recent run, which is what the UI links to. */
export function resolveRun(runId?: string | null): RunRef | null {
  const d = db();
  const row = (
    runId
      ? d.prepare(`SELECT id, period, started_at FROM run WHERE id = ?`).get(runId)
      : d.prepare(`SELECT id, period, started_at FROM run ORDER BY started_at DESC LIMIT 1`).get()
  ) as { id: string; period: string; started_at: string } | undefined;
  return row ? { id: row.id, period: row.period, startedAt: row.started_at } : null;
}

// ── audit log ────────────────────────────────────────────────────────────────

export interface AuditExportRow {
  id: number;
  ts: string;
  actor: string;
  actor_kind: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  trace_id: string | null;
  detail_json: string | null;
}

/** Every event of the run, agent and human alike, oldest first — the order it happened in. */
export function auditExportRows(runId: string): AuditExportRow[] {
  const rows = db()
    .prepare(
      `SELECT id, ts, actor, action, entity_type, entity_id, trace_id, detail_json
         FROM audit_event WHERE run_id = ? ORDER BY id ASC`
    )
    .all(runId) as Omit<AuditExportRow, "actor_kind">[];
  return rows.map((r) => ({ ...r, actor_kind: r.actor.split(":")[0] || "unknown" }));
}

// ── exceptions ───────────────────────────────────────────────────────────────

export interface ExceptionExportRow {
  id: string;
  created_at: string;
  category: string;
  severity: string;
  status: string;
  summary: string;
  suggested_action: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  match_id: string | null;
  match_method: string | null;
  match_model: string | null;
  match_confidence: number | null;
  match_status: string | null;
  match_reasoning: string | null;
  bank_txn_id: string | null;
  bank_posted_on: string | null;
  bank_amount_cents: number | null;
  bank_currency: string | null;
  bank_description: string | null;
  gl_entry_id: string | null;
  gl_booked_on: string | null;
  gl_amount_cents: number | null;
  gl_currency: string | null;
  gl_account_code: string | null;
  gl_memo: string | null;
  evidence_json: string | null;
}

export function exceptionExportRows(runId: string): ExceptionExportRow[] {
  return db()
    .prepare(
      `SELECT e.id, e.created_at, e.category, e.severity, e.status, e.summary, e.suggested_action,
              e.resolution_note, e.resolved_by, e.resolved_at,
              e.match_id, m.method AS match_method, m.model AS match_model,
              m.confidence AS match_confidence, m.status AS match_status, m.reasoning AS match_reasoning,
              e.bank_txn_id, b.posted_on AS bank_posted_on, b.amount_cents AS bank_amount_cents,
              b.currency AS bank_currency, b.description AS bank_description,
              e.gl_entry_id, g.booked_on AS gl_booked_on, g.amount_cents AS gl_amount_cents,
              g.currency AS gl_currency, g.account_code AS gl_account_code, g.memo AS gl_memo,
              e.evidence_json
         FROM exception e
         LEFT JOIN match    m ON m.id = e.match_id
         LEFT JOIN bank_txn b ON b.id = e.bank_txn_id
         LEFT JOIN gl_entry g ON g.id = e.gl_entry_id
        WHERE e.run_id = ?
        ORDER BY CASE e.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, e.category, e.id`
    )
    .all(runId) as ExceptionExportRow[];
}

/** `[{label, excerpt}]` -> one readable cell. The raw JSON helps nobody in a spreadsheet. */
export function evidenceText(json: string | null): string {
  if (!json) return "";
  try {
    const items = JSON.parse(json) as { label?: string; excerpt?: string; source_uri?: string }[];
    return items
      .map((i) => [i.label, i.excerpt, i.source_uri].filter(Boolean).join(": "))
      .join(" | ");
  } catch {
    return json;
  }
}

// ── journal ──────────────────────────────────────────────────────────────────

export interface JournalExportRow {
  je_id: string;
  entry_date: string;
  memo: string;
  status: string;
  posted_at: string | null;
  posted_by: string | null;
  match_id: string | null;
  match_method: string | null;
  match_model: string | null;
  match_confidence: number | null;
  line_no: number;
  account_code: string | null;
  debit_cents: number | null;
  credit_cents: number | null;
  entry_debit_cents: number;
  entry_credit_cents: number;
  blocked_by: string;
  block_reason: string;
  policy_warnings: string;
}

/**
 * One row per journal line. Blocked entries are included — an entry the system
 * refused to post is the part of the close an auditor most wants to see — and
 * each row carries the rule code that blocked it.
 */
export function journalExportRows(runId: string): JournalExportRow[] {
  const d = db();

  const entries = d
    .prepare(
      `SELECT j.id, j.entry_date, j.memo, j.status, j.posted_at, j.posted_by,
              j.match_id, m.method AS match_method, m.model AS match_model, m.confidence AS match_confidence
         FROM journal_entry j
         LEFT JOIN match m ON m.id = j.match_id
        WHERE j.run_id = ?
        ORDER BY j.entry_date ASC, j.id ASC`
    )
    .all(runId) as {
    id: string; entry_date: string; memo: string; status: string;
    posted_at: string | null; posted_by: string | null; match_id: string | null;
    match_method: string | null; match_model: string | null; match_confidence: number | null;
  }[];

  const lines = d
    .prepare(
      `SELECT l.je_id, l.id, l.account_code, l.debit_cents, l.credit_cents
         FROM journal_line l JOIN journal_entry j ON j.id = l.je_id
        WHERE j.run_id = ? ORDER BY l.id ASC`
    )
    .all(runId) as { je_id: string; id: number; account_code: string; debit_cents: number; credit_cents: number }[];

  const findings = d
    .prepare(
      `SELECT subject_id, rule_code, severity, message FROM policy_violation
        WHERE run_id = ? AND subject_type = 'journal_entry' ORDER BY id ASC`
    )
    .all(runId) as { subject_id: string; rule_code: string; severity: string; message: string }[];

  const byEntry = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byEntry.get(l.je_id) ?? [];
    list.push(l);
    byEntry.set(l.je_id, list);
  }

  const policyByEntry = new Map<string, typeof findings>();
  for (const f of findings) {
    const list = policyByEntry.get(f.subject_id) ?? [];
    list.push(f);
    policyByEntry.set(f.subject_id, list);
  }

  const out: JournalExportRow[] = [];
  for (const e of entries) {
    const entryLines = byEntry.get(e.id) ?? [];
    const policy = policyByEntry.get(e.id) ?? [];
    const blocks = policy.filter((p) => p.severity === "block");
    const warns = policy.filter((p) => p.severity !== "block");

    const shared = {
      je_id: e.id,
      entry_date: e.entry_date,
      memo: e.memo,
      status: e.status,
      posted_at: e.posted_at,
      posted_by: e.posted_by,
      match_id: e.match_id,
      match_method: e.match_method,
      match_model: e.match_model,
      match_confidence: e.match_confidence,
      entry_debit_cents: entryLines.reduce((s, l) => s + l.debit_cents, 0),
      entry_credit_cents: entryLines.reduce((s, l) => s + l.credit_cents, 0),
      blocked_by: blocks.map((b) => b.rule_code).join("; "),
      block_reason: blocks.map((b) => b.message).join(" | "),
      policy_warnings: warns.map((w) => `${w.rule_code}: ${w.message}`).join(" | "),
    };

    if (entryLines.length === 0) {
      // Shouldn't happen, but an entry that lost its lines is exactly the kind of
      // gap an export must show rather than silently drop.
      out.push({ ...shared, line_no: 0, account_code: null, debit_cents: null, credit_cents: null });
      continue;
    }
    entryLines.forEach((l, i) => {
      out.push({
        ...shared,
        line_no: i + 1,
        account_code: l.account_code,
        debit_cents: l.debit_cents,
        credit_cents: l.credit_cents,
      });
    });
  }
  return out;
}
