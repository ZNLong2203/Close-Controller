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
