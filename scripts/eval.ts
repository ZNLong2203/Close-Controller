/**
 * Eval harness.
 *
 * Scores a reconciliation run against the ground_truth table. The point is not
 * to produce a good-looking number: it is to make every claim in the README
 * falsifiable, and to make a regression in the matcher show up as a number
 * going down rather than as a demo that quietly stops working.
 *
 *   npm run eval               tiered pipeline (rules + model)
 *   npm run eval -- --baseline no rule tier; everything through the model
 *   npm run eval -- --write    run both and update docs/RESULTS.md
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { runReconciliation } from "../src/lib/matching/pipeline";
import { spansFor } from "../src/lib/trace";

interface CategoryScore {
  category: string;
  expected: number;
  detected: number;
  recall: number;
}

interface Scores {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  autoMatchRate: number;
  reviewRate: number;
  falseAutoPosts: number;
  excPrecision: number;
  excRecall: number;
  llmCalls: number;
  costUsd: number;
  costPer1k: number;
  p50: number;
  p95: number;
  wallMs: number;
  byCategory: CategoryScore[];
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) => `$${n.toFixed(4)}`;

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Clears derived state only. The fixture itself is untouched so both columns start level. */
function clearDerived(): void {
  const d = db();
  for (const t of [
    "policy_violation", "journal_line", "journal_entry",
    "exception", "match_line", "match", "audit_event", "run",
  ]) {
    d.exec(`DELETE FROM ${t}`);
  }
}

async function score(label: string): Promise<Scores> {
  clearDerived();
  const d = db();
  const { runId, stats } = await runReconciliation("2026-08");

  // ── pairwise match scoring ──────────────────────────────────────────────────
  const truthPairs = new Set(
    (d.prepare(`SELECT bank_txn_id, gl_entry_id FROM ground_truth WHERE relation='match'`).all() as {
      bank_txn_id: string;
      gl_entry_id: string;
    }[]).map((r) => `${r.bank_txn_id}|${r.gl_entry_id}`)
  );

  const matches = d
    .prepare(
      `SELECT m.id, m.status,
              (SELECT GROUP_CONCAT(entity_id) FROM match_line WHERE match_id=m.id AND entity_type='bank_txn') AS banks,
              (SELECT GROUP_CONCAT(entity_id) FROM match_line WHERE match_id=m.id AND entity_type='gl_entry') AS gls
         FROM match m
        WHERE m.run_id = ? AND m.status != 'rejected'`
    )
    .all(runId) as { id: string; status: string; banks: string | null; gls: string | null }[];

  const predicted = new Set<string>();
  let falseAutoPosts = 0;

  for (const m of matches) {
    const banks = (m.banks ?? "").split(",").filter(Boolean);
    const gls = (m.gls ?? "").split(",").filter(Boolean);
    let wrong = false;
    for (const b of banks) {
      for (const g of gls) {
        predicted.add(`${b}|${g}`);
        if (!truthPairs.has(`${b}|${g}`)) wrong = true;
      }
    }
    // The number that matters: booked without a human, and wrong.
    if (wrong && m.status === "auto_posted") falseAutoPosts++;
  }

  let tp = 0;
  for (const p of predicted) if (truthPairs.has(p)) tp++;
  const precision = predicted.size ? tp / predicted.size : 0;
  const recall = truthPairs.size ? tp / truthPairs.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  // ── exception detection ─────────────────────────────────────────────────────
  const expected = d
    .prepare(
      `SELECT expected_exception AS cat, bank_txn_id, gl_entry_id
         FROM ground_truth WHERE expected_exception IS NOT NULL`
    )
    .all() as { cat: string; bank_txn_id: string | null; gl_entry_id: string | null }[];

  const raised = d
    .prepare(`SELECT category, bank_txn_id, gl_entry_id FROM exception WHERE run_id = ?`)
    .all(runId) as { category: string; bank_txn_id: string | null; gl_entry_id: string | null }[];

  const raisedKeys = new Set(raised.map((r) => `${r.category}|${r.bank_txn_id ?? r.gl_entry_id ?? ""}`));
  const raisedByCat = raised.reduce<Record<string, number>>((a, r) => {
    a[r.category] = (a[r.category] ?? 0) + 1;
    return a;
  }, {});

  const cats = [...new Set(expected.map((e) => e.cat))].sort();
  const byCategory: CategoryScore[] = cats.map((category) => {
    const want = expected.filter((e) => e.cat === category);
    // Expectations carrying a subject are scored by subject. Three-way variances
    // are derived from documents rather than transactions and have none, so they
    // are scored by count.
    const hasSubject = want.some((w) => w.bank_txn_id || w.gl_entry_id);
    const detected = hasSubject
      ? want.filter((w) => raisedKeys.has(`${category}|${w.bank_txn_id ?? w.gl_entry_id ?? ""}`)).length
      : Math.min(want.length, raisedByCat[category] ?? 0);
    return { category, expected: want.length, detected, recall: want.length ? detected / want.length : 0 };
  });

  const totalExpected = byCategory.reduce((s, c) => s + c.expected, 0);
  const totalDetected = byCategory.reduce((s, c) => s + c.detected, 0);
  const raisedInScoredCats = cats.reduce((s, c) => s + (raisedByCat[c] ?? 0), 0);

  // ── latency ─────────────────────────────────────────────────────────────────
  const { trace_id } = d.prepare(`SELECT trace_id FROM run WHERE id=?`).get(runId) as { trace_id: string };
  const durations = spansFor(trace_id).filter((s) => s.name.startsWith("gemini.")).map((s) => s.durationMs);

  return {
    label,
    precision,
    recall,
    f1,
    autoMatchRate: stats.autoMatchRate,
    reviewRate: stats.totalBankTxns ? stats.pendingReview / stats.totalBankTxns : 0,
    falseAutoPosts,
    excPrecision: raisedInScoredCats ? totalDetected / raisedInScoredCats : 0,
    excRecall: totalExpected ? totalDetected / totalExpected : 0,
    llmCalls: stats.llmCallCount,
    costUsd: stats.costUsd,
    costPer1k: stats.totalBankTxns ? (stats.costUsd / stats.totalBankTxns) * 1000 : 0,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    wallMs: stats.wallMs,
    byCategory,
  };
}

function render(rows: Scores[]): string {
  const head = ["Metric", ...rows.map((r) => r.label)];
  const line = (name: string, f: (r: Scores) => string) => `| ${name} | ${rows.map(f).join(" | ")} |`;
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    line("Match precision", (r) => pct(r.precision)),
    line("Match recall", (r) => pct(r.recall)),
    line("Match F1", (r) => pct(r.f1)),
    line("Auto-match rate", (r) => pct(r.autoMatchRate)),
    line("Human-review rate", (r) => pct(r.reviewRate)),
    line("**False auto-posts**", (r) => `**${r.falseAutoPosts}**`),
    line("Exception precision", (r) => pct(r.excPrecision)),
    line("Exception recall", (r) => pct(r.excRecall)),
    line("LLM calls", (r) => String(r.llmCalls)),
    line("Cost (USD)", (r) => usd(r.costUsd)),
    line("Cost per 1,000 txns", (r) => usd(r.costPer1k)),
    line("LLM p50 / p95 latency", (r) => (r.p50 ? `${r.p50} / ${r.p95} ms` : "—")),
    line("Wall time", (r) => `${(r.wallMs / 1000).toFixed(2)} s`),
  ].join("\n");
}

function renderCategories(r: Scores): string {
  return [
    "| Category | Expected | Detected | Recall |",
    "|---|---|---|---|",
    ...r.byCategory.map((c) => `| \`${c.category}\` | ${c.expected} | ${c.detected} | ${pct(c.recall)} |`),
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const baselineOnly = args.includes("--baseline");

  const rows: Scores[] = [];

  if (baselineOnly || write) {
    process.env.CC_DISABLE_RULES = "1";
    rows.push(await score("Baseline (LLM-only)"));
    delete process.env.CC_DISABLE_RULES;
  }
  if (!baselineOnly) {
    rows.push(await score("Close Controller"));
  }

  const tiered = rows.find((r) => r.label === "Close Controller") ?? rows[rows.length - 1];

  console.log("\n" + render(rows) + "\n");
  console.log(renderCategories(tiered) + "\n");

  if (tiered.falseAutoPosts > 0) {
    console.error(
      `FAIL: ${tiered.falseAutoPosts} false auto-post(s). Nothing may be booked without a human unless it is right.`
    );
    process.exitCode = 1;
  }

  if (write) {
    const { n } = db().prepare(`SELECT COUNT(*) AS n FROM ground_truth`).get() as { n: number };
    const md = `# Results

Generated by \`npm run eval -- --write\` on ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC.

Scored against the \`ground_truth\` table — ${n} labelled rows across the failure
modes a real close actually contains. Ground truth is written only by the fixture
generator, never by the agent.

The baseline column disables the deterministic tier entirely and routes every
transaction through the model. It is there so the tiering claim can be checked
rather than taken on trust.

${render(rows)}

**False auto-posts** — matches booked without human review that ground truth says
are wrong — is the number that matters. Every other metric can be traded against
cost; this one cannot.

## Per-category exception detection

${renderCategories(tiered)}
`;
    writeFileSync(join(process.cwd(), "docs", "RESULTS.md"), md);
    console.log("wrote docs/RESULTS.md");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
