/** Drive one reconciliation run from the command line. */
import { runReconciliation } from "../src/lib/matching/pipeline";
import { detectPeriod } from "../src/lib/import/period";
import { db } from "../src/lib/db";

async function main() {
// Same entry point the UI uses. Hard-coding the fixture's month here made the
// CLI disagree with the app the moment an imported statement covered a
// different period, and every posting failed CLOSED_PERIOD.
const period = detectPeriod();
const { runId, stats } = await runReconciliation(period);
console.log(`period ${period}`);
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
