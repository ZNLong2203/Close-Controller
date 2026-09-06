import Link from "next/link";
import { DownloadCsv } from "@/components/DownloadCsv";
import { auditEvents, latestRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "Everything" },
  { key: "agent", label: "Agent" },
  { key: "human", label: "Human" },
];

export default async function Audit({ searchParams }: { searchParams: Promise<{ actor?: string }> }) {
  const sp = await searchParams;
  const run = latestRun();
  if (!run) {
    return (
      <p className="text-[13px] text-muted">
        No run yet — <Link href="/" className="text-accent hover:underline">start one</Link>.
      </p>
    );
  }

  const events = auditEvents(run.id, sp.actor);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Audit trail</h1>
          <p className="mt-1 text-[13px] text-muted">
            Agent and human decisions in one log, in the same shape. This is what makes the export usable as audit
            support rather than as a changelog.
          </p>
        </div>
        {/* The exports carry the whole run, not the filtered view on screen —
            an auditor asked for the close, not for what a reviewer had open. */}
        <div className="flex shrink-0 gap-2">
          <DownloadCsv href={`/api/export/audit?run=${run.id}`} label="Decision log CSV" />
          <DownloadCsv href={`/api/export/exceptions?run=${run.id}`} label="Exceptions CSV" />
        </div>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/audit?actor=${f.key}` : "/audit"}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              (sp.actor ?? "") === f.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted">
              <th className="px-3 py-2.5 font-medium">Time</th>
              <th className="px-3 py-2.5 font-medium">Actor</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
              <th className="px-3 py-2.5 font-medium">Entity</th>
              <th className="px-3 py-2.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 align-top">
                <td className="tabular whitespace-nowrap px-3 py-2 text-muted">{e.ts.slice(11, 19)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <code className={e.actor.startsWith("human") ? "text-accent" : "text-muted"}>{e.actor}</code>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{e.action}</td>
                <td className="tabular whitespace-nowrap px-3 py-2 text-muted">{e.entity_id ?? "—"}</td>
                <td className="max-w-md truncate px-3 py-2 text-muted" title={e.detail_json ?? ""}>
                  {e.detail_json ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted">
        Showing the most recent {events.length} events for run {run.id}. The CSV export carries every event of the
        run, with each detail field in its own column.
      </p>
    </div>
  );
}
