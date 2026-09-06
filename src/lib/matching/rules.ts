import type { MatchProposal } from "../types";
import type { Side } from "./normalize";

/**
 * Deterministic matching. This tier must carry the bulk of the volume — every
 * pair it resolves is a pair we never pay an LLM to think about. It runs in
 * passes, most-certain first, and each pass only sees what earlier passes left.
 *
 * WORKER A owns this file.
 *
 * Required passes:
 *   1. exact      - shared reference + identical amount            -> confidence 0.99
 *   2. exact-ish  - identical amount + same day + vendor match     -> confidence 0.95
 *   3. fuzzy      - amount within tolerance, date within 5 days,
 *                   vendor similarity > 0.8                        -> confidence 0.70-0.90
 *   4. one-to-many- subset-sum over same-vendor bank legs against a
 *                   single GL entry (partial payments)             -> confidence 0.85
 *   5. duplicates - two bank legs sharing a reference where only
 *                   one GL entry exists -> DO NOT match the second;
 *                   leave it for the exception builder
 */
export interface RuleResult {
  proposals: MatchProposal[];
  /** ids that no rule could place; handed to the LLM tier */
  residue: { bankIds: string[]; glIds: string[] };
}

export function runRuleMatchers(_side: Side): RuleResult {
  throw new Error("TODO(worker-a): runRuleMatchers");
}
