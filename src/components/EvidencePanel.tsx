import type { EvidenceItem } from "@/lib/types";

/**
 * Evidence, laid out the way a reviewer actually reads it: the two sides facing
 * each other, and the reasons the system paired them underneath. A flat list of
 * facts makes the reviewer do the sorting, which is the work we are meant to be
 * removing.
 */
export function EvidencePanel({ items }: { items: EvidenceItem[] }) {
  if (!items.length) return null;

  const bank = items.filter((e) => /^Bank\b/i.test(e.label));
  const ledger = items.filter((e) => /^(Ledger|Already settled by)\b/i.test(e.label));
  const signals = items.filter((e) => !bank.includes(e) && !ledger.includes(e));

  const Side = ({ title, rows, empty }: { title: string; rows: EvidenceItem[]; empty: string }) => (
    <div className="min-w-0">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">{title}</div>
      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-2.5 py-3 text-[12px] text-muted">{empty}</div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((e, i) => (
            <div key={i} className="rounded-md border border-border bg-bg p-2.5">
              <div className="text-[11px] font-medium text-muted">{e.label}</div>
              <div className="tabular mt-1 text-[12px] leading-snug break-words">{e.excerpt}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // A three-way variance is an argument between documents, not between a bank
  // line and a ledger entry. Rendering two empty placeholders there reads as a
  // broken panel, so the two-sided view only appears when there are two sides.
  const hasSides = bank.length > 0 || ledger.length > 0;

  return (
    <div className="space-y-3">
      {hasSides && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Side title="Bank" rows={bank} empty="No bank line — this exists only in the ledger." />
          <Side title="Ledger" rows={ledger} empty="No ledger entry — this cash movement was never booked." />
        </div>
      )}

      {signals.length > 0 && (
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
            {hasSides ? "What linked them" : "Supporting documents"}
          </div>
          <div className="space-y-1.5">
            {signals.map((e, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md bg-bg px-2.5 py-2">
                <span className="text-[11px] font-medium text-muted">{e.label}</span>
                <span className="tabular min-w-0 flex-1 text-[12px] leading-snug break-words">{e.excerpt}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
