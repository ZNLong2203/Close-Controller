import Link from "next/link";
import { journalTotals, journalWithLines, latestRun } from "@/lib/queries";

export const dynamic = "force-dynamic";

const money = (c: number) => (c === 0 ? "—" : `$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

const FILTERS = [
  { key: "", label: "All" },
  { key: "posted", label: "Posted" },
  { key: "blocked", label: "Blocked" },
];

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

  const totals = journalTotals(run.id);
  const entries = journalWithLines(run.id, sp.status || undefined);
  const balanced = totals.debits === totals.credits;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">General journal</h1>
          <p className="mt-1 text-[13px] text-muted">
            Every entry this close produced. Blocked entries are kept, not discarded — a refusal you cannot point at is
            indistinguishable from a bug.
          </p>
        </div>
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key ? `/journal?status=${f.key}` : "/journal"}
              className={`rounded-md border px-2.5 py-1 text-[12px] ${
                (sp.status ?? "") === f.key ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted">Posted</div>
          <div className="tabular mt-1 text-2xl font-semibold">{totals.posted}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted">Blocked</div>
          <div className={`tabular mt-1 text-2xl font-semibold ${totals.blocked ? "text-danger" : ""}`}>{totals.blocked}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted">Total debits</div>
          <div className="tabular mt-1 text-2xl font-semibold">{money(totals.debits)}</div>
        </div>
        <div className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] uppercase tracking-widest text-muted">Total credits</div>
          <div className="tabular mt-1 text-2xl font-semibold">{money(totals.credits)}</div>
        </div>
      </div>

      <div
        className={`rounded-lg border px-4 py-2.5 text-[13px] ${
          balanced ? "border-accent/30 bg-accent-soft text-accent" : "border-danger/40 bg-danger-soft text-danger"
        }`}
      >
        {balanced
          ? "Debits equal credits across every posted entry."
          : `Out of balance by ${money(totals.debits - totals.credits)} — the policy engine should have refused this.`}
      </div>

      <div className="space-y-2">
        {entries.map((e) => {
          const d = e.lines.reduce((s, l) => s + l.debit_cents, 0);
          const c = e.lines.reduce((s, l) => s + l.credit_cents, 0);
          const blocked = e.status === "blocked";
          return (
            <details
              key={e.id}
              open={blocked}
              className={`group rounded-lg border bg-panel ${blocked ? "border-danger/40" : "border-border"}`}
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                <span className="tabular text-muted">{e.entry_date}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    blocked ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
                  }`}
                >
                  {e.status}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.memo}</span>
                <span className="tabular text-muted">{money(d)}</span>
                <span className="text-[11px] text-muted transition-transform group-open:rotate-90">›</span>
              </summary>

              <div className="border-t border-border px-4 py-3">
                {e.violations.length > 0 && (
                  <ul className="mb-3 space-y-1">
                    {e.violations.map((v, i) => (
                      <li key={i} className="text-[12px] leading-relaxed">
                        <span
                          className={`tabular rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            v.severity === "block" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"
                          }`}
                        >
                          {v.rule_code}
                        </span>{" "}
                        {v.message}
                      </li>
                    ))}
                  </ul>
                )}

                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-muted">
                      <th className="pb-1.5 font-medium">Account</th>
                      <th className="pb-1.5 text-right font-medium">Debit</th>
                      <th className="pb-1.5 text-right font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {e.lines.map((l, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="py-1.5">{l.account_code}</td>
                        <td className="py-1.5 text-right">{money(l.debit_cents)}</td>
                        <td className="py-1.5 text-right">{money(l.credit_cents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-medium">
                      <td className="py-1.5">{d === c ? "Balanced" : "OUT OF BALANCE"}</td>
                      <td className="py-1.5 text-right">{money(d)}</td>
                      <td className="py-1.5 text-right">{money(c)}</td>
                    </tr>
                  </tbody>
                </table>

                <p className="mt-2 text-[11px] text-muted">
                  {e.posted_by ? `Posted by ${e.posted_by}` : "Not posted"}
                  {e.match_id ? ` · from match ${e.match_id}` : ""}
                </p>
              </div>
            </details>
          );
        })}
        {entries.length === 0 && (
          <p className="rounded-lg border border-border bg-panel p-6 text-center text-[13px] text-muted">
            No entries with this status.
          </p>
        )}
      </div>
    </div>
  );
}
