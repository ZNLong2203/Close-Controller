"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { appliesUnder, fieldsFor, type AmountMode, type ColumnMapping, type ImportKind } from "@/lib/import/mapping";
import type { DateOrder } from "@/lib/import/dates";
import type { PreviewPayload } from "@/lib/import/preview";

interface Inspection {
  headers: string[];
  delimiter: string;
  rowCount: number;
  mapping: ColumnMapping;
  sampleRows: string[][];
}

interface SideState {
  filename: string;
  csv: string;
  inspection: Inspection | null;
  mapping: ColumnMapping | null;
  preview: PreviewPayload | null;
  error: string | null;
  busy: boolean;
}

const EMPTY: SideState = {
  filename: "",
  csv: "",
  inspection: null,
  mapping: null,
  preview: null,
  error: null,
  busy: false,
};

const LABEL: Record<ImportKind, string> = { bank: "Bank statement", ledger: "General ledger export" };
const DELIMITER_NAME: Record<string, string> = { ",": "comma", ";": "semicolon", "\t": "tab", "|": "pipe" };

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

// ── dropzone ────────────────────────────────────────────────────────────────

function DropZone({
  kind,
  filename,
  busy,
  onText,
  onSample,
}: {
  kind: ImportKind;
  filename: string;
  busy: boolean;
  onText: (name: string, text: string) => void;
  onSample: () => void;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const take = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      onText(file.name, await file.text());
    },
    [onText]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files?.[0]);
      }}
      className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
        over ? "border-accent bg-accent-soft" : "border-border bg-panel"
      }`}
    >
      <div className="text-[13px] font-semibold">{LABEL[kind]}</div>
      <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
        {filename ? (
          <>
            Loaded <span className="text-text">{filename}</span>
          </>
        ) : (
          <>Drop a CSV here, or pick one. Nothing is written until you confirm the preview.</>
        )}
      </p>
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-accent-soft disabled:opacity-50"
        >
          Choose file
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onSample}
          className="rounded-md px-3 py-1.5 text-[12px] text-muted transition-colors hover:text-accent disabled:opacity-50"
        >
          Use bundled sample
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ── mapping editor ──────────────────────────────────────────────────────────

function MappingEditor({
  kind,
  headers,
  mapping,
  onChange,
}: {
  kind: ImportKind;
  headers: string[];
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const fields = fieldsFor(kind).filter((f) => appliesUnder(f.key, mapping.amountMode));

  const setColumn = (key: string, value: string) =>
    onChange({ ...mapping, columns: { ...mapping.columns, [key]: value === "" ? null : Number(value) } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted">Amount columns</span>
          <select
            value={mapping.amountMode}
            onChange={(e) => onChange({ ...mapping, amountMode: e.target.value as AmountMode })}
            className="mt-1 rounded-md border border-border bg-panel px-2 py-1.5 text-[13px]"
          >
            <option value="signed">One signed column</option>
            <option value="debit_credit">Separate debit &amp; credit</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] uppercase tracking-widest text-muted">Date format</span>
          <select
            value={mapping.dateOrder}
            onChange={(e) => onChange({ ...mapping, dateOrder: e.target.value as DateOrder })}
            className="mt-1 rounded-md border border-border bg-panel px-2 py-1.5 text-[13px]"
          >
            <option value="auto">Detect from the column</option>
            <option value="mdy">MM/DD/YYYY</option>
            <option value="dmy">DD/MM/YYYY</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => {
          const value = mapping.columns[f.key];
          return (
            <label key={f.key} className="block">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[12px] font-medium">{f.label}</span>
                {f.required && <span className="text-[10px] uppercase tracking-widest text-muted">required</span>}
                {value === null && f.required && <span className="text-[11px] text-danger">unmapped</span>}
              </span>
              <select
                value={value === null || value === undefined ? "" : String(value)}
                onChange={(e) => setColumn(f.key, e.target.value)}
                className={`mt-1 w-full rounded-md border bg-panel px-2 py-1.5 text-[13px] ${
                  value === null && f.required ? "border-danger/50" : "border-border"
                }`}
              >
                <option value="">— not mapped —</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-snug text-muted">{f.hint}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── preview ─────────────────────────────────────────────────────────────────

function Preview({ p }: { p: PreviewPayload }) {
  const isLedger = p.kind === "ledger";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Rows accepted" value={String(p.acceptedRows)} sub={`of ${p.totalRows} in the file`} />
        <Fact
          label="Rows rejected"
          value={String(p.rejectedRows)}
          sub={p.rejectedRows ? "listed below, not imported" : "every row parsed"}
          tone={p.rejectedRows ? "danger" : undefined}
        />
        <Fact
          label="Date range"
          value={p.dateFrom && p.dateTo ? (p.dateFrom === p.dateTo ? p.dateFrom : `${p.dateFrom} → ${p.dateTo}`) : "—"}
          sub={p.period ? `mostly ${p.period}` : undefined}
        />
        <Fact label="Net movement" value={p.net} sub="sum of the accepted rows" />
      </div>

      {p.missing.length > 0 && (
        <Callout tone="danger" title="Required columns are unmapped">
          {p.missing.join(", ")} — pick a column for each before importing.
        </Callout>
      )}

      {p.warnings.map((w, i) => (
        <Callout key={i} tone="warn" title="Worth checking before you confirm">
          {w}
        </Callout>
      ))}

      <div>
        <h4 className="mb-2 text-[11px] uppercase tracking-widest text-muted">
          First {p.sample.length} rows, as they will be inserted
        </h4>
        <div className="overflow-x-auto rounded-lg border border-border bg-panel">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-widest text-muted">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Ccy</th>
                {isLedger && <th className="px-3 py-2 font-medium">Account</th>}
                <th className="px-3 py-2 font-medium">{isLedger ? "Memo" : "Description"}</th>
                <th className="px-3 py-2 font-medium">{isLedger ? "Vendor" : "Counterparty"}</th>
                <th className="px-3 py-2 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {p.sample.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="tabular px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className={`tabular px-3 py-2 text-right ${r.amountCents < 0 ? "text-danger" : "text-accent"}`}>
                    {r.amount}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.currency}</td>
                  {isLedger && <td className="tabular px-3 py-2">{r.account}</td>}
                  <td className="max-w-[22rem] truncate px-3 py-2">{r.primary}</td>
                  <td className="px-3 py-2 text-muted">{r.secondary ?? "—"}</td>
                  <td className="tabular px-3 py-2 text-muted">{r.reference ?? "—"}</td>
                </tr>
              ))}
              {p.sample.length === 0 && (
                <tr>
                  <td colSpan={isLedger ? 7 : 6} className="px-3 py-6 text-center text-muted">
                    No row survived the mapping.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {p.rejected.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] uppercase tracking-widest text-muted">
            Rejected rows{p.rejectedRows > p.rejected.length ? ` (first ${p.rejected.length} of ${p.rejectedRows})` : ""}
          </h4>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-danger/40 bg-danger-soft">
            {p.rejected.map((r, i) => (
              <li key={i} className="px-3 py-2 text-[12px] leading-relaxed">
                <span className="tabular rounded bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
                  line {r.line}
                </span>{" "}
                <span className="text-text">{r.reason}</span>
                <div className="tabular mt-0.5 truncate text-[11px] text-muted">{r.cells.join(" · ")}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className={`tabular mt-1 text-[15px] font-semibold ${tone === "danger" ? "text-danger" : "text-text"}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function Callout({ tone, title, children }: { tone: "danger" | "warn"; title: string; children: React.ReactNode }) {
  const cls =
    tone === "danger" ? "border-danger/40 bg-danger-soft text-danger" : "border-warn/40 bg-warn-soft text-warn";
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-widest">{title}</div>
      <div className="mt-1 text-[13px] leading-relaxed text-text">{children}</div>
    </div>
  );
}

// ── one side of the import ──────────────────────────────────────────────────

function Side({
  kind,
  state,
  setState,
}: {
  kind: ImportKind;
  state: SideState;
  setState: (updater: (s: SideState) => SideState) => void;
}) {
  // Every dropdown change re-previews. Without a sequence guard a slow early
  // response can land after a fast later one and show the user a preview of a
  // mapping they have already changed — which, on a screen whose whole job is
  // "this is exactly what will be written", is the one lie it must not tell.
  const seq = useRef(0);

  const refreshPreview = useCallback(
    async (csv: string, mapping: ColumnMapping) => {
      const ticket = ++seq.current;
      setState((s) => ({ ...s, busy: true, error: null }));
      try {
        const preview = await postJson<PreviewPayload>("/api/import/preview", { kind, csv, mapping });
        if (ticket !== seq.current) return;
        setState((s) => ({ ...s, preview, busy: false }));
      } catch (e) {
        if (ticket !== seq.current) return;
        setState((s) => ({ ...s, busy: false, preview: null, error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [kind, setState]
  );

  const load = useCallback(
    async (filename: string, csv: string) => {
      seq.current++;
      setState(() => ({ ...EMPTY, filename, csv, busy: true }));
      // A dropped .xlsx reads as binary and would otherwise parse into a screen
      // of mojibake headers. Say what is wrong instead.
      if (csv.includes("\u0000")) {
        setState((s) => ({
          ...s,
          busy: false,
          error: `${filename} is not a text file. Export the sheet as CSV and drop that instead.`,
        }));
        return;
      }
      try {
        const inspection = await postJson<Inspection>("/api/import/parse", { kind, csv });
        setState((s) => ({ ...s, inspection, mapping: inspection.mapping, busy: false }));
        await refreshPreview(csv, inspection.mapping);
      } catch (e) {
        setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
      }
    },
    [kind, refreshPreview, setState]
  );

  const loadSample = useCallback(async () => {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const res = await fetch(`/api/import/sample?kind=${kind}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Sample not available");
      await load(json.filename as string, json.csv as string);
    } catch (e) {
      setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : String(e) }));
    }
  }, [kind, load, setState]);

  return (
    <section className="space-y-4">
      <DropZone
        kind={kind}
        filename={state.filename}
        busy={state.busy}
        onText={(name, text) => void load(name, text)}
        onSample={() => void loadSample()}
      />

      {state.error && (
        <Callout tone="danger" title="Could not read the file">
          {state.error}
        </Callout>
      )}

      {state.inspection && state.mapping && (
        <div className="space-y-5 rounded-lg border border-border bg-panel p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-[13px] font-semibold">Column mapping</h3>
            <p className="tabular text-[11px] text-muted">
              {state.inspection.headers.length} columns · {state.inspection.rowCount} rows ·{" "}
              {DELIMITER_NAME[state.inspection.delimiter] ?? "custom"}-separated
            </p>
          </div>
          <MappingEditor
            kind={kind}
            headers={state.inspection.headers}
            mapping={state.mapping}
            onChange={(m) => {
              setState((s) => ({ ...s, mapping: m }));
              void refreshPreview(state.csv, m);
            }}
          />
        </div>
      )}

      {state.preview && (
        <div className={state.busy ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <Preview p={state.preview} />
        </div>
      )}
    </section>
  );
}

// ── the wizard ──────────────────────────────────────────────────────────────

interface CommitResult {
  ok: boolean;
  batchId: string;
  bankInserted: number;
  glInserted: number;
  period: string | null;
}

export function ImportWizard() {
  const router = useRouter();
  const [bank, setBank] = useState<SideState>(EMPTY);
  const [ledger, setLedger] = useState<SideState>(EMPTY);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const sides = [
    { key: "bank" as const, state: bank },
    { key: "ledger" as const, state: ledger },
  ];
  const loaded = sides.filter((s) => s.state.preview);
  const blocked = loaded.some((s) => (s.state.preview?.missing.length ?? 0) > 0 || s.state.preview?.acceptedRows === 0);
  const totalRows = loaded.reduce((a, s) => a + (s.state.preview?.acceptedRows ?? 0), 0);
  const canImport = loaded.length > 0 && !blocked && !committing;

  async function commit() {
    setCommitting(true);
    setCommitError(null);
    try {
      const body = {
        replaceExisting,
        bank: bank.preview && bank.mapping ? { csv: bank.csv, mapping: bank.mapping, filename: bank.filename } : null,
        ledger:
          ledger.preview && ledger.mapping
            ? { csv: ledger.csv, mapping: ledger.mapping, filename: ledger.filename }
            : null,
      };
      await postJson<CommitResult>("/api/import/commit", body);
      // Straight to the dashboard: the next thing anyone wants is a close.
      router.push("/");
      router.refresh();
    } catch (e) {
      setCommitting(false);
      setCommitError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-10 lg:grid-cols-1">
        <Side kind="bank" state={bank} setState={setBank} />
        <Side kind="ledger" state={ledger} setState={setLedger} />
      </div>

      <div className="sticky bottom-0 -mx-6 border-t border-border bg-panel/95 px-6 py-4 backdrop-blur">
        {commitError && (
          <div className="mb-3">
            <Callout tone="danger" title="Import refused">
              {commitError}
            </Callout>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex max-w-lg items-start gap-2 text-[12px] leading-relaxed text-muted">
            <input
              type="checkbox"
              checked={replaceExisting}
              onChange={(e) => setReplaceExisting(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-text">Replace the existing dataset.</span> Clears the seeded fixture —
              bank lines, ledger entries, invoices, POs, receipts, ground truth and every run derived from them. Untick
              to append instead.
            </span>
          </label>
          <div className="flex items-center gap-3">
            <span className="tabular text-[12px] text-muted">
              {loaded.length === 0
                ? "No file loaded"
                : `${totalRows} row${totalRows === 1 ? "" : "s"} ready${blocked ? " · mapping incomplete" : ""}`}
            </span>
            <button
              type="button"
              disabled={!canImport}
              onClick={() => void commit()}
              className="rounded-md bg-accent px-5 py-2.5 text-[13px] font-medium text-panel transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {committing ? "Importing…" : "Import and run a close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
