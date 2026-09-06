import Link from "next/link";
import { EvidencePanel } from "@/components/EvidencePanel";
import { ReviewPanel } from "@/components/ReviewPanel";
import { exceptionCategories, exceptions, latestRun, matchDetail, parseEvidence } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Queue({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; id?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const run = latestRun();
  if (!run) {
    return (
      <p className="text-[13px] text-muted">
        No run yet — <Link href="/" className="text-accent hover:underline">start one</Link>.
      </p>
    );
  }

  const showStatus = sp.status ?? "open";
  const rows = exceptions(run.id, {
    category: sp.category,
    status: showStatus === "all" ? undefined : showStatus,
  });
  const selected = rows.find((r) => r.id === sp.id) ?? rows[0];
  const categories = exceptionCategories(run.id);

  const match = selected?.match_id ? matchDetail(selected.match_id) : undefined;
  const evidence = parseEvidence(selected?.evidence_json ?? match?.evidence_json ?? null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/exceptions"
          className={`rounded-md border px-2.5 py-1 text-[12px] ${!sp.category ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"}`}
        >
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.category}
            href={`/exceptions?category=${c.category}`}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              sp.category === c.category ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text"
            }`}
          >
            <code>{c.category}</code> <span className="tabular opacity-70">{c.open}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* queue */}
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-panel">
          {rows.length === 0 && <p className="p-4 text-[13px] text-muted">Nothing open here.</p>}
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/exceptions?${sp.category ? `category=${sp.category}&` : ""}id=${r.id}`}
              className={`block border-b border-border p-3 last:border-0 transition-colors hover:bg-bg ${
                selected?.id === r.id ? "bg-accent-soft" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    r.severity === "high" ? "bg-danger" : r.severity === "medium" ? "bg-warn" : "bg-muted"
                  }`}
                />
                <code className="text-[11px] text-muted">{r.category}</code>
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug">{r.summary}</p>
            </Link>
          ))}
        </div>

        {/* detail */}
        {selected ? (
          <div className="space-y-4 rounded-lg border border-border bg-panel p-5">
            <div>
              <div className="flex items-center gap-2">
                <code className="rounded bg-bg px-1.5 py-0.5 text-[11px]">{selected.category}</code>
                <span
                  className={`text-[11px] font-medium ${
                    selected.severity === "high" ? "text-danger" : selected.severity === "medium" ? "text-warn" : "text-muted"
                  }`}
                >
                  {selected.severity}
                </span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed">{selected.summary}</p>
            </div>

            <EvidencePanel items={evidence} />

            {match && (
              <div className="rounded-md border border-border bg-bg p-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">Why the system paired these</h3>
                  <span className="tabular text-[11px] text-muted">
                    {(match.confidence * 100).toFixed(0)}% · {match.method}
                    {match.model ? ` · ${match.model}` : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed">{match.reasoning}</p>
              </div>
            )}

            <div className="rounded-md border border-accent/30 bg-accent-soft p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-accent">Suggested action</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-text">{selected.suggested_action}</p>
            </div>

            {selected.resolution_note && (
              <p className="text-[12px] text-muted">
                {selected.resolved_by ? `${selected.resolved_by}: ` : ""}
                {selected.resolution_note}
              </p>
            )}

            <ReviewPanel
              exceptionId={selected.id}
              canApprove={Boolean(selected.match_id)}
              canForce={Boolean(!selected.match_id && selected.bank_txn_id && selected.gl_entry_id)}
              status={selected.status}
            />
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-panel p-8 text-center text-[13px] text-muted">
            Select an item to review it.
          </div>
        )}
      </div>
    </div>
  );
}
