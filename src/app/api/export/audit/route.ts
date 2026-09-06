import { csvResponse, flattenDetail, toCsv, type Column } from "@/lib/export/csv";
import { auditExportRows, resolveRun, type AuditExportRow } from "@/lib/export/rows";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/export/audit?run=<id>
 *
 * The full decision log for a run — agent and human in the same shape, one row
 * per event. Each event's detail JSON is flattened into its own columns, so a
 * reviewer reads `detail.confidence` in a cell instead of parsing a blob.
 */
export async function GET(req: Request): Promise<Response> {
  const run = resolveRun(new URL(req.url).searchParams.get("run"));
  if (!run) return new Response("no such run\n", { status: 404 });

  const rows = auditExportRows(run.id);

  // Flatten once, then take the union of the keys in first-seen order: the
  // columns end up in the order the run produced them, not alphabetically.
  const details = rows.map((r) => {
    if (!r.detail_json) return {};
    try {
      return flattenDetail(JSON.parse(r.detail_json) as unknown);
    } catch {
      return { raw: r.detail_json };
    }
  });
  const detailKeys: string[] = [];
  const seen = new Set<string>();
  for (const d of details) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        detailKeys.push(k);
      }
    }
  }

  type Row = { event: AuditExportRow; detail: Record<string, string> };
  const columns: Column<Row>[] = [
    { header: "event_id", value: (r) => r.event.id },
    { header: "run_id", value: () => run.id },
    { header: "period", value: () => run.period },
    { header: "ts", value: (r) => r.event.ts },
    { header: "actor", value: (r) => r.event.actor },
    { header: "actor_kind", value: (r) => r.event.actor_kind },
    { header: "action", value: (r) => r.event.action },
    { header: "entity_type", value: (r) => r.event.entity_type },
    { header: "entity_id", value: (r) => r.event.entity_id },
    { header: "trace_id", value: (r) => r.event.trace_id },
    ...detailKeys.map((k) => ({ header: `detail.${k}`, value: (r: Row) => r.detail[k] ?? "" })),
  ];

  const csv = toCsv(columns, rows.map((event, i) => ({ event, detail: details[i] })));
  return csvResponse(csv, `close-audit-log_${run.period}_${run.id}.csv`);
}
