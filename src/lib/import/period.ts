import { db } from "../db";
import { modalPeriod } from "./dates";

/**
 * Which month a close should be run for.
 *
 * The fixture is August 2026, but an imported statement is whatever month the
 * judge's bank sent. Deriving the period from the data rather than hard-coding
 * it is what stops every posting from an imported file hitting CLOSED_PERIOD.
 */
export function detectPeriod(fallback = "2026-08"): string {
  const rows = db()
    .prepare(
      `SELECT posted_on AS d FROM bank_txn
       UNION ALL
       SELECT booked_on AS d FROM gl_entry`
    )
    .all() as { d: string }[];
  return modalPeriod(rows.map((r) => r.d)) ?? fallback;
}
