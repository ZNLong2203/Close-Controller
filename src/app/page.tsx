import Link from "next/link";
import { RunButton } from "@/components/RunButton";
import { exceptionCategories, journalTotals, latestRun, policyViolations, tierBreakdown } from "@/lib/queries";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => (n === 0 ? "$0.00" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "accent" | "danger";
}) {
  const color = tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular mt-1.5 text-3xl font-semibold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] leading-snug text-muted">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const run = latestRun();

  if (!run) {
    return (
      <div className="rounded-lg border border-border bg-panel p-10 text-center">
        <h1 className="text-lg font-semibold">No reconciliation has been run yet</h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
          Seed the fixture with <code className="rounded bg-bg px-1.5 py-0.5">npm run seed</code>, then run a close over
          August 2026.
        </p>
        <div className="mt-6">
          <RunButton />
        </div>
      </div>
    );
  }

  const s = run.stats;
  const summary = exceptionCategories(run.id);
  const openTotal = summary.reduce((a, c) => a + c.open, 0);
  const blocks = policyViolations(run.id, 8).filter((v) => v.severity === "block");
  const tiers = tierBreakdown(run.id);
  const totals = journalTotals(run.id);
  const totalMatches = tiers.reduce((a, t) => a + t.matches, 0) || 1;
  const costPer1k = s?.totalBankTxns ? ((s.costUsd ?? 0) / s.totalBankTxns) * 1000 : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">August 2026 close</h1>
          <p className="tabular mt-1 text-[12px] text-muted">
            {run.id} · {s?.totalBankTxns ?? 0} bank lines against {s?.totalGlEntries ?? 0} ledger entries ·{" "}
            {((s?.wallMs ?? 0) / 1000).toFixed(2)}s
          </p>
        </div>
        <RunButton label="Re-run close" variant="quiet" />
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Auto-matched"
          value={pct(s?.autoMatchRate ?? 0)}
          sub={`${s?.autoMatched ?? 0} entries booked unattended`}
          tone="accent"
        />
        <Stat label="Awaiting review" value={String(openTotal)} sub="typed, with evidence attached" />
        <Stat
          label="Model cost"
          value={`${usd(costPer1k)} / 1k`}
          sub={`${usd(s?.costUsd ?? 0)} for this close · ${s?.llmCallCount ?? 0} API calls`}
        />
        <Stat
          label="Refused by policy"
          value={String(totals.blocked)}
          sub={totals.blocked ? "postings the guardrails stopped" : "no violations this run"}
          tone={totals.blocked ? "danger" : undefined}
        />
      </section>

      {blocks.length > 0 && (
        <section className="rounded-lg border border-danger/40 bg-danger-soft p-4">
          <h2 className="text-[13px] font-semibold text-danger">Policy refused a posting</h2>
          <ul className="mt-2 space-y-1.5">
            {blocks.map((v, i) => (
              <li key={i} className="text-[13px] leading-relaxed">
                <span className="tabular rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                  {v.rule_code}
                </span>{" "}
                <span className="text-text">{v.message}</span>
              </li>
            ))}
          </ul>
          <Link href="/journal?status=blocked" className="mt-3 inline-block text-[12px] text-danger hover:underline">
            See the blocked entries →
          </Link>
        </section>
      )}

      {/* The cost argument, shown rather than asserted: what each tier actually
          resolved, and what it actually cost to resolve it. */}
      <section>
        <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-muted">Where the matches came from</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{t.tier}</span>
                  <span className="truncate text-[11px] text-muted">{t.detail}</span>
                </div>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-bg">
                  <div
                    className={t.tier === "Gemini" ? "h-full bg-warn" : "h-full bg-accent"}
                    style={{ width: `${(t.matches / totalMatches) * 100}%` }}
                  />
                </div>
              </div>
              <div className="tabular w-20 text-right text-[13px] font-medium">{t.matches}</div>
              <div className="tabular w-24 text-right text-[13px] text-muted">
                {t.costUsd === 0 ? "free" : usd(t.costUsd)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          The model only ever sees what the rules could not place. That is why the cost line stays small as volume
          grows — spend tracks ambiguity, not transaction count.
        </p>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-widest text-muted">Review queue</h2>
          <Link href="/exceptions" className="text-[13px] text-accent hover:underline">
            Open queue →
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted">
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Highest severity</th>
                <th className="px-4 py-2.5 text-right font-medium">Open</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((c, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/exceptions?category=${c.category}`} className="hover:text-accent hover:underline">
                      <code>{c.category}</code>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        c.severity === "high"
                          ? "bg-danger-soft text-danger"
                          : c.severity === "medium"
                            ? "bg-warn-soft text-warn"
                            : "text-muted"
                      }`}
                    >
                      {c.severity}
                    </span>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-medium">{c.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
