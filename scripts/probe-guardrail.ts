/** Scratch probe: prove a reviewer cannot force a duplicate payment through. */
import { db } from "../src/lib/db";
import { decideException } from "../src/lib/review";

const d = db();
const run = d.prepare(`SELECT id FROM run ORDER BY started_at DESC LIMIT 1`).get() as { id: string };
const dup = d.prepare(
  `SELECT id, summary FROM exception WHERE run_id = ? AND category = 'duplicate_suspect' AND status='open' LIMIT 1`
).get(run.id) as { id: string; summary: string } | undefined;

if (!dup) { console.log("no duplicate_suspect exception found"); process.exit(1); }
console.log(`exception ${dup.id}\n  ${dup.summary}\n`);
console.log("reviewer clicks 'post anyway'...\n");

const outcome = decideException(dup.id, "post_anyway", "zkare", "Vendor insists it is a second invoice");
console.log(`  status: ${outcome.status.toUpperCase()}`);
console.log(`  ${outcome.message}\n`);
console.log("policy findings recorded:");
console.table(
  d.prepare(`SELECT rule_code, severity, message FROM policy_violation WHERE run_id = ? ORDER BY id DESC LIMIT 3`).all(run.id)
);
console.log(`exception status is now: ${(d.prepare(`SELECT status FROM exception WHERE id=?`).get(dup.id) as any).status}`);
