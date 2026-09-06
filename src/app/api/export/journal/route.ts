import { csvResponse, dollars, toCsv, type Column } from "@/lib/export/csv";
import { journalExportRows, resolveRun, type JournalExportRow } from "@/lib/export/rows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/export/journal?run=<id>
 *
 * Journal entries with their lines, one row per line. Blocked entries are in
 * here too, carrying the rule code and message that refused them — a refusal
 * you cannot point at afterwards is indistinguishable from a bug.
 */
export async function GET(req: Request): Promise<Response> {
  const run = resolveRun(new URL(req.url).searchParams.get("run"));
  if (!run) return new Response("no such run\n", { status: 404 });

  const columns: Column<JournalExportRow>[] = [
    { header: "je_id", value: (r) => r.je_id },
    { header: "run_id", value: () => run.id },
    { header: "period", value: () => run.period },
    { header: "entry_date", value: (r) => r.entry_date },
    { header: "status", value: (r) => r.status },
    { header: "memo", value: (r) => r.memo },
    { header: "posted_at", value: (r) => r.posted_at },
    { header: "posted_by", value: (r) => r.posted_by },
    { header: "line_no", value: (r) => r.line_no },
    { header: "account_code", value: (r) => r.account_code },
    { header: "debit_cents", value: (r) => r.debit_cents },
    { header: "debit", value: (r) => dollars(r.debit_cents) },
    { header: "credit_cents", value: (r) => r.credit_cents },
    { header: "credit", value: (r) => dollars(r.credit_cents) },
    { header: "entry_debit_cents", value: (r) => r.entry_debit_cents },
    { header: "entry_credit_cents", value: (r) => r.entry_credit_cents },
    { header: "entry_balanced", value: (r) => (r.entry_debit_cents === r.entry_credit_cents ? "yes" : "no") },
    { header: "match_id", value: (r) => r.match_id },
    { header: "match_method", value: (r) => r.match_method },
    { header: "match_model", value: (r) => r.match_model },
    { header: "match_confidence", value: (r) => (r.match_confidence === null ? "" : r.match_confidence.toFixed(4)) },
    { header: "blocked_by_rule", value: (r) => r.blocked_by },
    { header: "block_reason", value: (r) => r.block_reason },
    { header: "policy_warnings", value: (r) => r.policy_warnings },
  ];

  const csv = toCsv(columns, journalExportRows(run.id));
  return csvResponse(csv, `close-journal_${run.period}_${run.id}.csv`);
}
