import { db, id, nowIso } from "./db";
import { audit } from "./audit";
import { evaluatePolicy, isBlocked, type PolicyFinding } from "./policy/guardrails";
import { glRefs } from "./matching/normalize";
import type { BankTxn, GlEntry } from "./types";

/**
 * Turns an approved match into a balanced journal entry — after the policy
 * engine has had its say.
 *
 * A blocked entry is persisted with status 'blocked' rather than discarded. A
 * refusal you cannot point at afterwards is indistinguishable from a bug, and
 * "the system silently did nothing" is not something a controller can sign off.
 */

const CASH_ACCOUNT = "1000";
const BANK_FEE_ACCOUNT = "6900";
const FX_ACCOUNT = "7100";

export interface PostResult {
  jeId: string;
  status: "posted" | "blocked";
  findings: PolicyFinding[];
}

export function postMatch(
  runId: string,
  matchId: string,
  actor: "agent" | "human",
  actorName = "agent:posting"
): PostResult {
  const d = db();

  const run = d.prepare(`SELECT period FROM run WHERE id = ?`).get(runId) as { period: string } | undefined;
  const period = run?.period ?? new Date().toISOString().slice(0, 7);

  const lines = d
    .prepare(`SELECT entity_type, entity_id FROM match_line WHERE match_id = ?`)
    .all(matchId) as { entity_type: string; entity_id: string }[];

  const banks = lines
    .filter((l) => l.entity_type === "bank_txn")
    .map((l) => d.prepare(`SELECT * FROM bank_txn WHERE id = ?`).get(l.entity_id) as BankTxn)
    .filter(Boolean);
  const gls = lines
    .filter((l) => l.entity_type === "gl_entry")
    .map((l) => d.prepare(`SELECT * FROM gl_entry WHERE id = ?`).get(l.entity_id) as GlEntry)
    .filter(Boolean);

  if (!banks.length || !gls.length) {
    throw new Error(`match ${matchId} has no bank or ledger side to post`);
  }

  const bankSum = banks.reduce((s, b) => s + b.amount_cents, 0);
  const glSum = gls.reduce((s, g) => s + g.amount_cents, 0);
  const moneyOut = bankSum < 0;
  const gross = Math.abs(glSum);
  const cleared = Math.abs(bankSum);
  const variance = gross - cleared; // positive: the bank kept a fee
  const crossCcy = banks.some((b) => gls.some((g) => g.currency !== b.currency));

  // ── build a balanced entry ──────────────────────────────────────────────────
  const entryLines: { accountCode: string; debitCents: number; creditCents: number }[] = [];
  const varianceAccount = crossCcy ? FX_ACCOUNT : BANK_FEE_ACCOUNT;

  if (moneyOut) {
    // Settling a liability: charge the expense accounts, release the cash.
    for (const g of gls) entryLines.push({ accountCode: g.account_code, debitCents: Math.abs(g.amount_cents), creditCents: 0 });
    entryLines.push({ accountCode: CASH_ACCOUNT, debitCents: 0, creditCents: cleared });
    if (variance !== 0) {
      entryLines.push(
        variance > 0
          ? { accountCode: varianceAccount, debitCents: 0, creditCents: variance }
          : { accountCode: varianceAccount, debitCents: -variance, creditCents: 0 }
      );
    }
  } else {
    // Collecting a receivable: cash in, clear the receivable, absorb the fee.
    entryLines.push({ accountCode: CASH_ACCOUNT, debitCents: cleared, creditCents: 0 });
    for (const g of gls) entryLines.push({ accountCode: g.account_code, debitCents: 0, creditCents: Math.abs(g.amount_cents) });
    if (variance !== 0) {
      entryLines.push(
        variance > 0
          ? { accountCode: varianceAccount, debitCents: variance, creditCents: 0 }
          : { accountCode: varianceAccount, debitCents: 0, creditCents: -variance }
      );
    }
  }

  const reference = gls.flatMap(glRefs)[0];
  const vendor = gls.find((g) => g.vendor)?.vendor ?? undefined;
  const entryDate = banks.map((b) => b.posted_on).sort().at(-1)!;
  const memo = `Reconciliation ${matchId}${reference ? ` · ${reference}` : ""}${vendor ? ` · ${vendor}` : ""}`;

  const findings = evaluatePolicy({
    runId, period, entryDate, lines: entryLines,
    vendor, reference, amountCents: bankSum,
    currency: banks[0].currency, isCrossCurrency: crossCcy, actor,
  });

  const blocked = isBlocked(findings);
  const status = blocked ? "blocked" : "posted";
  const jeId = id("je");

  d.transaction(() => {
    d.prepare(
      `INSERT INTO journal_entry (id, run_id, match_id, entry_date, memo, status, posted_at, posted_by)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(jeId, runId, matchId, entryDate, memo, status, blocked ? null : nowIso(), blocked ? null : actorName);

    const insLine = d.prepare(
      `INSERT INTO journal_line (je_id, account_code, debit_cents, credit_cents) VALUES (?,?,?,?)`
    );
    for (const l of entryLines) insLine.run(jeId, l.accountCode, l.debitCents, l.creditCents);

    const insViolation = d.prepare(
      `INSERT INTO policy_violation (run_id, subject_type, subject_id, rule_code, severity, message, created_at)
       VALUES (?,?,?,?,?,?,?)`
    );
    // Warnings are recorded too. A check that passed quietly is still evidence
    // that the check ran, which is what an auditor is actually asking for.
    for (const f of findings) insViolation.run(runId, "journal_entry", jeId, f.ruleCode, f.severity, f.message, nowIso());

    if (blocked) {
      d.prepare(`UPDATE match SET status = 'blocked' WHERE id = ?`).run(matchId);
    }
  })();

  audit({
    runId, actor: actorName,
    action: blocked ? "posting.blocked" : "posting.posted",
    entityType: "journal_entry", entityId: jeId,
    detail: { matchId, findings, lines: entryLines.length, amountCents: bankSum },
  });

  return { jeId, status, findings };
}
