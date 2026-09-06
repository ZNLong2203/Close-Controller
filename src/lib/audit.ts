import { db, nowIso } from "./db";

/**
 * Every state change goes through here. The audit trail is a deliverable, not
 * debug output: the review UI and the export both read straight off this table.
 */
export function audit(e: {
  runId?: string;
  actor: string;                 // 'agent:matcher' | 'agent:policy' | `human:${string}`
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: unknown;
  traceId?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO audit_event (run_id, ts, actor, action, entity_type, entity_id, detail_json, trace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      e.runId ?? null, nowIso(), e.actor, e.action,
      e.entityType ?? null, e.entityId ?? null,
      e.detail === undefined ? null : JSON.stringify(e.detail),
      e.traceId ?? null
    );
}

export function auditTrail(runId: string) {
  return db()
    .prepare(`SELECT * FROM audit_event WHERE run_id = ? ORDER BY id ASC`)
    .all(runId);
}
