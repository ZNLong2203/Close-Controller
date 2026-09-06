import type { MatchProposal } from "./types";

/**
 * Turns leftovers into a *typed, actionable* queue. A flat list of "unmatched"
 * is not a deliverable — a controller needs to know which pile a row belongs in
 * and what the system thinks they should do about it.
 *
 * WORKER D owns this file (alongside the policy engine — same reviewer mental model).
 *
 * Must emit, at minimum:
 *   unmatched_bank / unmatched_gl  from the residue
 *   duplicate_suspect              two bank legs share a reference, one GL entry
 *   amount_variance                matched but amounts differ (netted bank fees)
 *   fx_variance                    matched across currencies
 *   low_confidence                 proposal landed between REVIEW_FLOOR and AUTO_POST
 *   three_way_variance             invoice > goods receipt for a PO
 *
 * Every exception needs a `suggested_action` a human can act on in one click.
 * Returns the number of exceptions written.
 */
export function buildExceptions(
  _runId: string,
  _residue: { bankIds: string[]; glIds: string[] },
  _proposals: MatchProposal[]
): number {
  throw new Error("TODO(worker-d): buildExceptions");
}
