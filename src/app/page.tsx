import Link from "next/link";
import { startRun } from "./actions";
import { exceptionSummary, journalEntries, latestRun, policyViolations } from "@/lib/queries";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => (n === 0 ? "$0.00" : `$${n.toFixed(4)}`);

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "accent" | "danger" }) {
  const color = tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-text";
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular mt-1.5 text-3xl font-semibold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-[12px] text-muted">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const run = latestRun();

  if (!run) {
    return (
      <div className="rounded-lg border border-border bg-panel p-10 text-center">
        <h1 className="text-lg font-semibold">No reconciliation has been run yet</h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] text-muted">
          Seed the fixture with <code className="rounded bg-bg px-1.5 py-0.5">npm run seed</code>, then run a close over
          August 2026.
        </p>
        <form action={startRun} className="mt-6">
          <button className="rounded-md bg-accent px-5 py-2.5 text-[13px] font-medium text-panel transition-opacity hover:opacity-90">
            Run reconciliation
          </button>
        </form>
      </div>
    );
  }

  const s = run.stats;
  const summary = exceptionSummary(run.id);
  const openTotal = summary.reduce((a, c) => a + c.open, 0);
  const violations = policyViolations(run.id, 5);
  const blocks = violations.filter((v) => v.severity === "block");
  const blockedEntries = journalEntries(run.id, "blocked");

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">August 2026 close</h1>
          <p className="tabular mt-1 text-[12px] text-muted">
            Run {run.id} · {s?.totalBankTxns ?? 0} bank lines against {s?.totalGlEntries ?? 0} ledger entries ·{" "}
            {((s?.wallMs ?? 0) / 1000).toFixed(2)}s
          </p>
        </div>
        <form action={startRun}>
          <button className="rounded-md border border-border bg-panel px-4 py-2 text-[13px] font-medium transition-colors hover:bg-accent-soft">
            Re-run
          </button>
        </form>
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
          value={usd(s?.costUsd ?? 0)}
          sub={`${s?.llmCallCount ?? 0} calls · rules carried the rest`}
        />
        <Stat
          label="Refused by policy"
          value={String(blockedEntries.length)}
          sub={blockedEntries.length ? "postings the guardrails stopped" : "no violations this run"}
          tone={blockedEntries.length ? "danger" : undefined}
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
        </section>
      )}

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
                <th className="px-4 py-2.5 font-medium">Severity</th>
                <th className="px-4 py-2.5 text-right font-medium">Open</th>
                <th className="px-4 py-2.5 text-right font-medium">Total</th>
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
                  <td className="tabular px-4 py-2.5 text-right text-muted">{c.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
