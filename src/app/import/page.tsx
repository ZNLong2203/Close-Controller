import { ImportWizard } from "./ImportWizard";
import { recentImports } from "@/lib/import/ingest";

export const dynamic = "force-dynamic";

interface ImportDetail {
  replaceExisting?: boolean;
  bank?: { source: string; inserted: number; rejected: number } | null;
  ledger?: { source: string; inserted: number; rejected: number } | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

function describe(detail: ImportDetail): string {
  const parts: string[] = [];
  if (detail.bank) parts.push(`${detail.bank.inserted} bank lines from ${detail.bank.source}`);
  if (detail.ledger) parts.push(`${detail.ledger.inserted} ledger entries from ${detail.ledger.source}`);
  const rejected = (detail.bank?.rejected ?? 0) + (detail.ledger?.rejected ?? 0);
  if (rejected) parts.push(`${rejected} row(s) rejected`);
  return parts.join(" · ") || "nothing";
}

export default function ImportPage() {
  const history = recentImports();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Import your own data</h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
          Two CSVs — a bank statement and a general ledger export. No two exports share a schema, so the columns are
          guessed and then left for you to correct. Rows whose date or amount cannot be read exactly are listed and
          skipped rather than coerced; nothing is written until you confirm the preview.
        </p>
      </header>

      <ImportWizard />

      {history.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-widest text-muted">Import history</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 font-medium">Batch</th>
                  <th className="px-4 py-2.5 font-medium">What</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const detail = (h.detail_json ? JSON.parse(h.detail_json) : {}) as ImportDetail;
                  return (
                    <tr key={h.id} className="border-b border-border last:border-0">
                      <td className="tabular px-4 py-2.5 whitespace-nowrap text-muted">{h.ts.replace("T", " ").slice(0, 19)}</td>
                      <td className="px-4 py-2.5">{h.actor}</td>
                      <td className="tabular px-4 py-2.5 text-muted">{h.entity_id}</td>
                      <td className="px-4 py-2.5">{describe(detail)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Read straight off <code>audit_event</code> — the same table the audit trail export reads.
          </p>
        </section>
      )}
    </div>
  );
}
