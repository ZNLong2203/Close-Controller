import { csvResponse, dollars, toCsv, type Column } from "@/lib/export/csv";
import { evidenceText, exceptionExportRows, resolveRun, type ExceptionExportRow } from "@/lib/export/rows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/export/exceptions?run=<id>
 *
 * Every exception raised by a run with its category, severity, summary,
 * suggested action and resolution — plus the two documents it sits between, so
 * the file stands on its own without the app.
 */
export async function GET(req: Request): Promise<Response> {
  const run = resolveRun(new URL(req.url).searchParams.get("run"));
  if (!run) return new Response("no such run\n", { status: 404 });

  const columns: Column<ExceptionExportRow>[] = [
    { header: "exception_id", value: (r) => r.id },
    { header: "run_id", value: () => run.id },
    { header: "period", value: () => run.period },
    { header: "raised_at", value: (r) => r.created_at },
    { header: "category", value: (r) => r.category },
    { header: "severity", value: (r) => r.severity },
    { header: "status", value: (r) => r.status },
    { header: "summary", value: (r) => r.summary },
    { header: "suggested_action", value: (r) => r.suggested_action },
    { header: "resolution_note", value: (r) => r.resolution_note },
    { header: "resolved_by", value: (r) => r.resolved_by },
    { header: "resolved_at", value: (r) => r.resolved_at },
    { header: "match_id", value: (r) => r.match_id },
    { header: "match_method", value: (r) => r.match_method },
    { header: "match_model", value: (r) => r.match_model },
    { header: "match_confidence", value: (r) => (r.match_confidence === null ? "" : r.match_confidence.toFixed(4)) },
    { header: "match_status", value: (r) => r.match_status },
    { header: "match_reasoning", value: (r) => r.match_reasoning },
    { header: "bank_txn_id", value: (r) => r.bank_txn_id },
    { header: "bank_posted_on", value: (r) => r.bank_posted_on },
    { header: "bank_amount_cents", value: (r) => r.bank_amount_cents },
    { header: "bank_amount", value: (r) => dollars(r.bank_amount_cents) },
    { header: "bank_currency", value: (r) => r.bank_currency },
    { header: "bank_description", value: (r) => r.bank_description },
    { header: "gl_entry_id", value: (r) => r.gl_entry_id },
    { header: "gl_booked_on", value: (r) => r.gl_booked_on },
    { header: "gl_amount_cents", value: (r) => r.gl_amount_cents },
    { header: "gl_amount", value: (r) => dollars(r.gl_amount_cents) },
    { header: "gl_currency", value: (r) => r.gl_currency },
    { header: "gl_account_code", value: (r) => r.gl_account_code },
    { header: "gl_memo", value: (r) => r.gl_memo },
    { header: "evidence", value: (r) => evidenceText(r.evidence_json) },
  ];

  const csv = toCsv(columns, exceptionExportRows(run.id));
  return csvResponse(csv, `close-exceptions_${run.period}_${run.id}.csv`);
}
