/**
 * Policy engine. Runs before anything is posted, and again when a human clicks
 * approve — a human approving a bad entry is exactly the case that needs the
 * check most.
 *
 * WORKER D owns this file.
 *
 * Rules to implement (rule_code -> severity):
 *   BALANCED_ENTRY    block - debits must equal credits
 *   DUPLICATE_PAYMENT block - same vendor + amount + reference already posted this period
 *   CLOSED_PERIOD     block - entry_date falls outside the run's open period
 *   UNAPPROVED_LIMIT  block - auto-post above $10,000 requires a human regardless of confidence
 *   STALE_FX          warn  - cross-currency match with no rate recorded
 *   ROUND_DOLLAR      warn  - suspiciously round large amount, common fraud signal
 */
export interface PolicyFinding {
  ruleCode: string;
  severity: "block" | "warn";
  message: string;
}

export interface PolicyInput {
  runId: string;
  period: string;                                  // '2026-08'
  entryDate: string;
  lines: { accountCode: string; debitCents: number; creditCents: number }[];
  vendor?: string;
  reference?: string;
  amountCents: number;
  currency: string;
  isCrossCurrency?: boolean;
}

export function evaluatePolicy(_input: PolicyInput): PolicyFinding[] {
  throw new Error("TODO(worker-d): evaluatePolicy");
}

export const isBlocked = (f: PolicyFinding[]) => f.some((x) => x.severity === "block");
