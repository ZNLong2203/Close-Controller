import { db } from "../db";

/**
 * Policy engine. Runs before anything is posted, and again when a human clicks
 * approve.
 *
 * The second pass is not redundant. A reviewer approving a duplicate payment at
 * the end of a long close is precisely the case these checks exist for, and a
 * system that only validates its own actions has no answer for it.
 */

export interface PolicyFinding {
  ruleCode: string;
  severity: "block" | "warn";
  message: string;
}

export interface PolicyInput {
  runId: string;
  /** The open period, 'YYYY-MM'. Anything outside it cannot be posted. */
  period: string;
  entryDate: string;
  lines: { accountCode: string; debitCents: number; creditCents: number }[];
  vendor?: string;
  reference?: string;
  amountCents: number;
  currency: string;
  isCrossCurrency?: boolean;
  fxRate?: number;
  /** Who is posting. The approval limit applies to unattended posts only. */
  actor: "agent" | "human";
  /** Exclude this journal entry when looking for prior duplicates (re-approval). */
  excludeJeId?: string;
}

/** Unattended posts above this need a person, whatever the model's confidence. */
const AUTO_POST_LIMIT_CENTS = 1_000_000; // $10,000
const ROUND_DOLLAR_FLOOR_CENTS = 500_000; // $5,000

const money = (c: number) => `$${Math.abs(c / 100).toFixed(2)}`;

export function evaluatePolicy(input: PolicyInput): PolicyFinding[] {
  const findings: PolicyFinding[] = [];

  // ── the entry must balance ──────────────────────────────────────────────────
  const debits = input.lines.reduce((s, l) => s + l.debitCents, 0);
  const credits = input.lines.reduce((s, l) => s + l.creditCents, 0);
  if (debits !== credits) {
    findings.push({
      ruleCode: "BALANCED_ENTRY",
      severity: "block",
      message: `Debits ${money(debits)} do not equal credits ${money(credits)} — out by ${money(debits - credits)}.`,
    });
  }
  if (!input.lines.length) {
    findings.push({ ruleCode: "BALANCED_ENTRY", severity: "block", message: "Entry has no lines." });
  }

  // ── the period must be open ─────────────────────────────────────────────────
  if (!input.entryDate.startsWith(input.period)) {
    findings.push({
      ruleCode: "CLOSED_PERIOD",
      severity: "block",
      message: `Entry dated ${input.entryDate} falls outside the open period ${input.period}.`,
    });
  }

  // ── the same obligation must not be paid twice ──────────────────────────────
  if (input.reference && input.vendor) {
    const prior = db()
      .prepare(
        `SELECT je.id, je.entry_date
           FROM journal_entry je
          WHERE je.run_id = ?
            AND je.status = 'posted'
            AND je.id != COALESCE(?, '')
            AND je.memo LIKE ?`
      )
      .all(input.runId, input.excludeJeId ?? null, `%${input.reference}%`) as { id: string; entry_date: string }[];

    if (prior.length) {
      findings.push({
        ruleCode: "DUPLICATE_PAYMENT",
        severity: "block",
        message: `Reference ${input.reference} was already posted on ${prior[0].entry_date} as ${prior[0].id}. Posting again would pay ${input.vendor} twice.`,
      });
    }
  }

  // ── unattended posts have a ceiling ─────────────────────────────────────────
  if (input.actor === "agent" && Math.abs(input.amountCents) > AUTO_POST_LIMIT_CENTS) {
    findings.push({
      ruleCode: "UNAPPROVED_LIMIT",
      severity: "block",
      message: `${money(input.amountCents)} exceeds the ${money(AUTO_POST_LIMIT_CENTS)} unattended posting limit. A person must approve this regardless of match confidence.`,
    });
  }

  // ── warnings: worth a reviewer's eye, not worth stopping the close ──────────
  if (input.isCrossCurrency && !input.fxRate) {
    findings.push({
      ruleCode: "STALE_FX",
      severity: "warn",
      message: "Cross-currency entry with no exchange rate recorded — the FX gain/loss line cannot be substantiated.",
    });
  }

  if (Math.abs(input.amountCents) >= ROUND_DOLLAR_FLOOR_CENTS && Math.abs(input.amountCents) % 100_000 === 0) {
    findings.push({
      ruleCode: "ROUND_DOLLAR",
      severity: "warn",
      message: `${money(input.amountCents)} is an exact round thousand — worth confirming against the source document.`,
    });
  }

  return findings;
}

export const isBlocked = (f: PolicyFinding[]) => f.some((x) => x.severity === "block");
