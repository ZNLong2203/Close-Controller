import { db } from "./db";
import type { EvidenceItem, RunStats, Severity } from "./types";

/** Read models for the UI. Kept separate from the pipeline so views never mutate. */

export interface RunSummary {
  id: string;
  period: string;
  startedAt: string;
  finishedAt: string | null;
  stats: RunStats | null;
}

export function latestRun(): RunSummary | null {
  const r = db()
    .prepare(`SELECT id, period, started_at, finished_at, stats_json FROM run ORDER BY started_at DESC LIMIT 1`)
    .get() as
    | { id: string; period: string; started_at: string; finished_at: string | null; stats_json: string | null }
    | undefined;
  if (!r) return null;
  return {
    id: r.id,
    period: r.period,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    stats: r.stats_json ? (JSON.parse(r.stats_json) as RunStats) : null,
  };
}

export interface CategoryCount {
  category: string;
  severity: Severity;
  open: number;
  total: number;
}

export function exceptionSummary(runId: string): CategoryCount[] {
  return db()
    .prepare(
      `SELECT category, severity,
              SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open,
              COUNT(*) AS total
         FROM exception WHERE run_id = ?
        GROUP BY category, severity
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, total DESC`
    )
    .all(runId) as CategoryCount[];
}

export interface ExceptionRow {
  id: string;
  category: string;
  severity: Severity;
  summary: string;
  suggested_action: string;
  status: string;
  match_id: string | null;
  bank_txn_id: string | null;
  gl_entry_id: string | null;
  evidence_json: string | null;
  resolution_note: string | null;
  resolved_by: string | null;
}

export function exceptions(runId: string, opts: { category?: string; status?: string } = {}): ExceptionRow[] {
  const where = ["run_id = ?"];
  const args: unknown[] = [runId];
  if (opts.category) {
    where.push("category = ?");
    args.push(opts.category);
  }
  if (opts.status) {
    where.push("status = ?");
    args.push(opts.status);
  }
  return db()
    .prepare(
      `SELECT id, category, severity, summary, suggested_action, status,
              match_id, bank_txn_id, gl_entry_id, evidence_json, resolution_note, resolved_by
         FROM exception
        WHERE ${where.join(" AND ")}
        ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id`
    )
    .all(...args) as ExceptionRow[];
}

export const parseEvidence = (json: string | null): EvidenceItem[] => {
  if (!json) return [];
  try {
    return JSON.parse(json) as EvidenceItem[];
  } catch {
    return [];
  }
};

export interface MatchDetail {
  id: string;
  confidence: number;
  method: string;
  model: string | null;
  reasoning: string;
  evidence_json: string | null;
  status: string;
}

export const matchDetail = (matchId: string): MatchDetail | undefined =>
  db()
    .prepare(`SELECT id, confidence, method, model, reasoning, evidence_json, status FROM match WHERE id = ?`)
    .get(matchId) as MatchDetail | undefined;

export interface PolicyRow {
  rule_code: string;
  severity: string;
  message: string;
  created_at: string;
}

export const policyViolations = (runId: string, limit = 50): PolicyRow[] =>
  db()
    .prepare(
      `SELECT rule_code, severity, message, created_at FROM policy_violation
        WHERE run_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(runId, limit) as PolicyRow[];

export interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail_json: string | null;
}

export function auditEvents(runId: string, actorFilter?: string): AuditRow[] {
  const like = actorFilter ? `${actorFilter}%` : "%";
  return db()
    .prepare(
      `SELECT id, ts, actor, action, entity_type, entity_id, detail_json
         FROM audit_event WHERE run_id = ? AND actor LIKE ?
        ORDER BY id DESC LIMIT 400`
    )
    .all(runId, like) as AuditRow[];
}

export interface JournalRow {
  id: string;
  entry_date: string;
  memo: string;
  status: string;
  posted_by: string | null;
}

export const journalEntries = (runId: string, status?: string): JournalRow[] =>
  db()
    .prepare(
      `SELECT id, entry_date, memo, status, posted_by FROM journal_entry
        WHERE run_id = ? ${status ? "AND status = ?" : ""} ORDER BY entry_date DESC, id DESC LIMIT 200`
    )
    .all(...(status ? [runId, status] : [runId])) as JournalRow[];

/** Match counts and spend per tier — the evidence behind the cost claim. */
export interface TierRow {
  tier: "Deterministic rules" | "Gemini" | "Reviewer override";
  detail: string;
  matches: number;
  costUsd: number;
}

export function tierBreakdown(runId: string): TierRow[] {
  const rows = db()
    .prepare(
      `SELECT method, model, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost
         FROM match WHERE run_id = ? AND status != 'rejected'
        GROUP BY method, model`
    )
    .all(runId) as { method: string; model: string | null; n: number; cost: number }[];

  const rules = rows.filter((r) => r.method.startsWith("rule"));
  const llm = rows.filter((r) => r.method === "llm");
  const human = rows.filter((r) => r.method === "human");

  const out: TierRow[] = [];
  if (rules.length) {
    out.push({
      tier: "Deterministic rules",
      detail: rules.map((r) => `${r.method.replace("rule_", "")} ${r.n}`).join(" · "),
      matches: rules.reduce((s, r) => s + r.n, 0),
      costUsd: 0,
    });
  }
  out.push({
    tier: "Gemini",
    detail: llm.length ? [...new Set(llm.map((r) => r.model ?? "unknown"))].join(" · ") : "no residue reached the model",
    matches: llm.reduce((s, r) => s + r.n, 0),
    costUsd: llm.reduce((s, r) => s + r.cost, 0),
  });
  if (human.length) {
    out.push({
      tier: "Reviewer override",
      detail: "posted against the system's advice",
      matches: human.reduce((s, r) => s + r.n, 0),
      costUsd: 0,
    });
  }
  return out;
}

export interface JournalLine {
  account_code: string;
  debit_cents: number;
  credit_cents: number;
}

export interface JournalEntryFull {
  id: string;
  entry_date: string;
  memo: string;
  status: string;
  posted_by: string | null;
  match_id: string | null;
  lines: JournalLine[];
  violations: { rule_code: string; severity: string; message: string }[];
}

export function journalWithLines(runId: string, status?: string, limit = 250): JournalEntryFull[] {
  const d = db();
  const entries = d
    .prepare(
      `SELECT id, entry_date, memo, status, posted_by, match_id FROM journal_entry
        WHERE run_id = ? ${status ? "AND status = ?" : ""}
        ORDER BY CASE status WHEN 'blocked' THEN 0 ELSE 1 END, entry_date DESC, id DESC
        LIMIT ?`
    )
    .all(...(status ? [runId, status, limit] : [runId, limit])) as Omit<JournalEntryFull, "lines" | "violations">[];

  const lineStmt = d.prepare(
    `SELECT account_code, debit_cents, credit_cents FROM journal_line WHERE je_id = ? ORDER BY id`
  );
  const violStmt = d.prepare(
    `SELECT rule_code, severity, message FROM policy_violation WHERE subject_id = ? ORDER BY id`
  );

  return entries.map((e) => ({
    ...e,
    lines: lineStmt.all(e.id) as JournalLine[],
    violations: violStmt.all(e.id) as { rule_code: string; severity: string; message: string }[],
  }));
}

export function journalTotals(runId: string): { posted: number; blocked: number; debits: number; credits: number } {
  const d = db();
  const counts = d
    .prepare(`SELECT status, COUNT(*) AS n FROM journal_entry WHERE run_id = ? GROUP BY status`)
    .all(runId) as { status: string; n: number }[];
  const sums = d
    .prepare(
      `SELECT COALESCE(SUM(l.debit_cents),0) AS debits, COALESCE(SUM(l.credit_cents),0) AS credits
         FROM journal_line l JOIN journal_entry e ON e.id = l.je_id
        WHERE e.run_id = ? AND e.status = 'posted'`
    )
    .get(runId) as { debits: number; credits: number };
  return {
    posted: counts.find((c) => c.status === "posted")?.n ?? 0,
    blocked: counts.find((c) => c.status === "blocked")?.n ?? 0,
    ...sums,
  };
}
