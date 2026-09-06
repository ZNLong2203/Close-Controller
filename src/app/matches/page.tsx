import Link from "next/link";
import { EvidencePanel } from "@/components/EvidencePanel";
import { latestRun, matchTierCounts, matchesForRun, parseEvidence } from "@/lib/queries";

export const dynamic = "force-dynamic";

const money = (c: number) =>
  `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Tier = "rules" | "llm" | "human";
const isTier = (v: string | undefined): v is Tier => v === "rules" || v === "llm" || v === "human";

export default async function Matches({ searchParams }: { searchParams: Promise<{ tier?: string }> }) {
  const sp = await searchParams;
  const run = latestRun();
  if (!run) {
    return (
      <p className="text-[13px] text-muted">
        No run yet — <Link href="/" className="text-accent hover:underline">start one</Link>.
      </p>
    );
  }

  const tier = isTier(sp.tier) ? sp.tier : undefined;
  const counts = matchTierCounts(run.id);
  const rows = matchesForRun(run.id, tier);

  const filters: { key?: Tier; label: string; n: number }[] = [
    { key: undefined, label: "All", n: counts.rules + counts.llm + counts.human },
    { key: "rules", label: "Deterministic rules", n: counts.rules },
    { key: "llm", label: "Gemini", n: counts.llm },
  ];
  if (counts.human) filters.push({ key: "human", label: "Reviewer override", n: counts.human });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Matches</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">
          Every pairing this close made, and why. Model matches post above the confidence gate, so they never reach the
          review queue — this is where you check that the tier earned its place.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.label}
            href={f.key ? `/matches?tier=${f.key}` : "/matches"}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              (sp.tier ?? "") === (f.key ?? "")
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted hover:text-text"
            }`}
          >
            {f.label} <span className="tabular opacity-70">{f.n}</span>
          </Link>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((m) => {
          const evidence = parseEvidence(m.evidence_json);
          const byModel = m.method === "llm";
          const signal = evidence.find((e) => e.label === "Signal")?.excerpt;
          return (
            <details key={m.id} className="group rounded-lg border border-border bg-panel">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px]">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    byModel ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"
                  }`}
                >
                  {byModel ? (m.model ?? "gemini") : m.method.replace("rule_", "rule · ")}
                </span>
                <span className="tabular text-muted">{(m.confidence * 100).toFixed(0)}%</span>
                {signal && <code className="rounded bg-bg px-1.5 py-0.5 text-[11px] text-muted">{signal}</code>}
                <span className="min-w-0 flex-1 truncate text-muted">{m.reasoning}</span>
                <span className="tabular font-medium">{money(m.amount_cents)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    m.status === "auto_posted" ? "text-muted" : "bg-warn-soft text-warn"
                  }`}
                >
                  {m.status.replace("_", " ")}
                </span>
                <span className="text-[11px] text-muted transition-transform group-open:rotate-90">›</span>
              </summary>

              <div className="space-y-3 border-t border-border px-4 py-3">
                <p className="text-[13px] leading-relaxed">{m.reasoning}</p>
                <EvidencePanel items={evidence} />
                <p className="tabular text-[11px] text-muted">
                  {m.id} · bank {m.bank_ids ?? "—"} · ledger {m.gl_ids ?? "—"}
                </p>
              </div>
            </details>
          );
        })}
        {rows.length === 0 && (
          <p className="rounded-lg border border-border bg-panel p-6 text-center text-[13px] text-muted">
            No matches in this tier. If the model tier is empty, the rules placed everything — which is the cheapest
            possible outcome, not a failure.
          </p>
        )}
      </div>
    </div>
  );
}
