export type MatchStatus = "auto_posted" | "pending_review" | "approved" | "rejected" | "blocked";
export type MatchMethod = "rule_exact" | "rule_fuzzy" | "llm" | "human";
export type MatchKind = "bank_gl" | "three_way";

export type ExceptionCategory =
  | "unmatched_bank"
  | "unmatched_gl"
  | "amount_variance"
  | "duplicate_suspect"
  | "timing_difference"
  | "fx_variance"
  | "low_confidence"
  | "policy_block"
  | "three_way_variance";

export type Severity = "low" | "medium" | "high";

export interface BankTxn {
  id: string;
  posted_on: string;
  amount_cents: number;
  currency: string;
  description: string;
  counterparty: string | null;
  external_ref: string | null;
}

export interface GlEntry {
  id: string;
  booked_on: string;
  amount_cents: number;
  currency: string;
  account_code: string;
  memo: string;
  vendor: string | null;
  doc_type: string | null;
  doc_ref: string | null;
}

export interface EvidenceItem {
  label: string;
  source_uri?: string;
  excerpt: string;
}

export interface MatchProposal {
  kind: MatchKind;
  bankTxnIds: string[];
  glEntryIds: string[];
  confidence: number;
  method: MatchMethod;
  model?: string;
  reasoning: string;
  evidence: EvidenceItem[];
  costUsd?: number;
  latencyMs?: number;
  /** Set once the proposal has been written to the match table. */
  matchId?: string;
}

/** Above AUTO_POST -> booked without a human. Below REVIEW_FLOOR -> not even proposed, raised as unmatched. */
export const CONFIDENCE = {
  AUTO_POST: 0.9,
  REVIEW_FLOOR: 0.45,
} as const;

export interface RunStats {
  totalBankTxns: number;
  totalGlEntries: number;
  autoMatched: number;
  pendingReview: number;
  unmatched: number;
  autoMatchRate: number;
  llmCallCount: number;
  costUsd: number;
  wallMs: number;
}
