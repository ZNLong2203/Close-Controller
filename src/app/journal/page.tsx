import Link from "next/link";
import { DownloadCsv } from "@/components/DownloadCsv";
import { dollars } from "@/lib/export/csv";
import { journalExportRows, type JournalExportRow } from "@/lib/export/rows";
import { latestRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Groups the flat export rows back into entries, preserving order. */
function byEntry(rows: JournalExportRow[]): JournalExportRow[][] {
  const groups = new Map<string, JournalExportRow[]>();
  for (const r of rows) {
    const g = groups.get(r.je_id) ?? [];
    g.push(r);
    groups.set(r.je_id, g);
  }
  return [...groups.values()];
}

export default async function Journal({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const run = latestRun();
  if (!run) {
    return (
      <p className="text-[13px] text-muted">
        No run yet — <Link href="/" className="text-accent hover:underline">start one</Link>.
      </p>
    );
  }

  const all = byEntry(journalExportRows(run.id));
  const filter = sp.status ?? "";
  const entries = filter ? all.filter((e) => e[0].status === filter) : all;
  const counts = {
    posted: all.filter((e) => e[0].status === "posted").length,
    blocked: all.filter((e) => e[0].status === "blocked").length,
  };

  const FILTERS = [
    { key: "", label: `All ${all.length}` },
    { key: "posted", label: `Posted ${counts.posted}` },
    { key: "blocked", label: `Blocked ${counts.blocked}` },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Journal</h1>
          <p className="mt-1 text-[13px] text-muted">
            Every entry this run produced, balanced and with its lines. Entries the policy engine refused are kept
            here with the rule that refused them, not dropped.
          </p>
        </div>
        <DownloadCsv href={`/api/export/journal?run=${run.id}`} label="Journal CSV" />
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/journal?status=${f.key}` : "/journal"}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              filter === f.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {entries.length === 0 && <p className="text-[13px] text-muted">Nothing here for this run.</p>}

      <div className="space-y-3">
        {entries.map((lines) => {
          const e = lines[0];
          const balanced = e.entry_debit_cents === e.entry_credit_cents;
          return (
            <div key={e.je_id} className="rounded-lg border border-border bg-panel p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="tabular text-[12px] text-muted">{e.entry_date}</span>
                  <code className="text-[11px] text-muted">{e.je_id}</code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      e.status === "blocked" ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
                    }`}
                  >
                    {e.status}
                  </span>
                </div>
                <span className="tabular text-[11px] text-muted">
                  {e.posted_by ?? "—"}
                  {e.match_method ? ` · ${e.match_method}` : ""}
                  {e.match_confidence !== null ? ` · ${(e.match_confidence * 100).toFixed(0)}%` : ""}
                </span>
              </div>

              <p className="mt-1.5 text-[13px] leading-snug">{e.memo}</p>

              <table className="mt-3 w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted">
                    <th className="py-1.5 font-medium">Account</th>
                    <th className="py-1.5 text-right font-medium">Debit</th>
                    <th className="py-1.5 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.line_no} className="border-b border-border last:border-0">
                      <td className="tabular py-1.5">{l.account_code ?? "—"}</td>
                      <td className="tabular py-1.5 text-right">{l.debit_cents ? dollars(l.debit_cents) : ""}</td>
                      <td className="tabular py-1.5 text-right">{l.credit_cents ? dollars(l.credit_cents) : ""}</td>
                    </tr>
                  ))}
                  <tr className="text-muted">
                    <td className="py-1.5 text-[11px] uppercase tracking-widest">
                      {balanced ? "Balanced" : "Out of balance"}
                    </td>
                    <td className="tabular py-1.5 text-right">{dollars(e.entry_debit_cents)}</td>
                    <td className="tabular py-1.5 text-right">{dollars(e.entry_credit_cents)}</td>
                  </tr>
                </tbody>
              </table>

              {e.block_reason && (
                <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft p-2.5 text-[12px] leading-relaxed text-danger">
                  <code className="text-[11px]">{e.blocked_by}</code> — {e.block_reason}
                </p>
              )}
              {e.policy_warnings && (
                <p className="mt-2 text-[12px] leading-relaxed text-warn">{e.policy_warnings}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
