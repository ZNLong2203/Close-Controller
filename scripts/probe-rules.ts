/** Scratch probe: score the deterministic tier alone against ground truth. */
import { db } from "../src/lib/db";
import { runRuleMatchers } from "../src/lib/matching/rules";
import type { BankTxn, GlEntry } from "../src/lib/types";

const d = db();
const bank = d.prepare(`SELECT * FROM bank_txn ORDER BY posted_on, id`).all() as BankTxn[];
const gl = d.prepare(`SELECT * FROM gl_entry ORDER BY booked_on, id`).all() as GlEntry[];
const truth = d.prepare(`SELECT * FROM ground_truth WHERE relation='match'`).all() as
  { bank_txn_id: string; gl_entry_id: string; note: string }[];

const t0 = Date.now();
const { proposals, residue } = runRuleMatchers({ bank, gl });
const ms = Date.now() - t0;

const predicted = new Set<string>();
for (const p of proposals) for (const b of p.bankTxnIds) for (const g of p.glEntryIds) predicted.add(`${b}|${g}`);
const expected = new Set(truth.map((t) => `${t.bank_txn_id}|${t.gl_entry_id}`));

let tp = 0;
for (const p of predicted) if (expected.has(p)) tp++;
const fp = predicted.size - tp;
const fn = expected.size - tp;

console.log(`rule tier: ${proposals.length} proposals in ${ms}ms`);
console.table({
  bank_txns: bank.length,
  pairs_predicted: predicted.size,
  pairs_expected: expected.size,
  true_positives: tp,
  false_positives: fp,
  false_negatives: fn,
  precision: +(tp / (tp + fp || 1)).toFixed(4),
  recall: +(tp / (tp + fn || 1)).toFixed(4),
  bank_coverage: +((bank.length - residue.bankIds.length) / bank.length).toFixed(4),
  residue_bank: residue.bankIds.length,
  residue_gl: residue.glIds.length,
});

if (fp) {
  console.log("\nFALSE POSITIVES (matched but ground truth disagrees):");
  for (const p of [...predicted].filter((x) => !expected.has(x)).slice(0, 12)) {
    const [b, g] = p.split("|");
    const bt = bank.find((x) => x.id === b)!;
    const ge = gl.find((x) => x.id === g);
    console.log(`  ${b} "${bt.description}" ${bt.amount_cents}  ->  ${g} "${ge?.memo}" ${ge?.amount_cents}`);
  }
}
if (fn) {
  console.log("\nMISSED (ground truth says match, rules left it):");
  const missed = truth.filter((t) => !predicted.has(`${t.bank_txn_id}|${t.gl_entry_id}`));
  const byNote = new Map<string, number>();
  for (const m of missed) byNote.set(m.note, (byNote.get(m.note) ?? 0) + 1);
  for (const [note, n] of [...byNote].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${note}`);
}
