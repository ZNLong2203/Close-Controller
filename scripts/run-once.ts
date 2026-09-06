/** Drive one reconciliation run from the command line. */
import { runReconciliation } from "../src/lib/matching/pipeline";
import { db } from "../src/lib/db";

async function main() {
const { runId, stats } = await runReconciliation("2026-08");
console.log(`\nrun ${runId}`);
console.table(stats);

const d = db();
console.log("\nexceptions by category:");
console.table(
  d.prepare(`SELECT category, severity, COUNT(*) AS n FROM exception WHERE run_id = ?
             GROUP BY category, severity ORDER BY n DESC`).all(runId)
);
console.log("\npolicy findings:");
console.table(
  d.prepare(`SELECT rule_code, severity, COUNT(*) AS n FROM policy_violation WHERE run_id = ?
             GROUP BY rule_code, severity ORDER BY n DESC`).all(runId)
);
console.log("\njournal entries:");
console.table(
  d.prepare(`SELECT status, COUNT(*) AS n FROM journal_entry WHERE run_id = ? GROUP BY status`).all(runId)
);
}

main().catch((e) => { console.error(e); process.exit(1); });
