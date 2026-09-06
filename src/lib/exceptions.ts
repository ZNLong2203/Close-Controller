import { db, id, nowIso } from "./db";
import { audit } from "./audit";
import { bankRefs, glRefs } from "./matching/normalize";
import {
  CONFIDENCE,
  type BankTxn, type EvidenceItem, type ExceptionCategory,
  type GlEntry, type MatchProposal, type Severity,
} from "./types";

/**
 * Turns everything unresolved into a typed, actionable queue.
 *
 * A flat list of "unmatched" is not a deliverable. A controller needs to know
 * which pile a row belongs in and what the system thinks they should do about
 * it — that is the difference between a report and a workflow.
 */

interface Draft {
  category: ExceptionCategory;
  severity: Severity;
  summary: string;
  suggestedAction: string;
  matchId?: string;
  bankTxnId?: string;
  glEntryId?: string;
  evidence?: EvidenceItem[];
}

const money = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(c / 100).toFixed(2)}`;

export function buildExceptions(
  runId: string,
  residue: { bankIds: string[]; glIds: string[] },
  proposals: MatchProposal[]
): number {
  const d = db();
  const drafts: Draft[] = [];

  const bankById = new Map(
    (d.prepare(`SELECT * FROM bank_txn`).all() as BankTxn[]).map((b) => [b.id, b])
  );
  const glById = new Map(
    (d.prepare(`SELECT * FROM gl_entry`).all() as GlEntry[]).map((g) => [g.id, g])
  );

  // References that a *matched* ledger entry already carries. A leftover bank
  // line quoting one of them is not merely unmatched — it is a second payment
  // against an invoice that has already been settled, which is the single most
  // expensive error in accounts payable.
  const settledRefs = new Map<string, string>();
  for (const p of proposals) {
    for (const gid of p.glEntryIds) {
      const g = glById.get(gid);
      if (!g) continue;
      for (const r of glRefs(g)) settledRefs.set(r, gid);
    }
  }

  // ── leftovers on the bank side ──────────────────────────────────────────────
  for (const bid of residue.bankIds) {
    const b = bankById.get(bid);
    if (!b) continue;
    const dupRef = bankRefs(b).find((r) => settledRefs.has(r));

    if (dupRef) {
      drafts.push({
        category: "duplicate_suspect",
        severity: "high",
        summary: `${b.posted_on} · ${money(b.amount_cents)} to ${b.counterparty ?? "unknown party"} quotes ${dupRef}, which is already settled by ledger entry ${settledRefs.get(dupRef)}.`,
        suggestedAction: "Confirm with the vendor and open a recovery claim. Do not post.",
        bankTxnId: b.id,
        glEntryId: settledRefs.get(dupRef),
        evidence: [
          { label: `Bank ${b.id}`, excerpt: `${b.posted_on} · ${money(b.amount_cents)} · ${b.description}` },
          { label: "Already settled by", excerpt: `${settledRefs.get(dupRef)} carries the same reference ${dupRef}` },
        ],
      });
    } else {
      drafts.push({
        category: "unmatched_bank",
        severity: Math.abs(b.amount_cents) > 100_000 ? "high" : "low",
        summary: `${b.posted_on} · ${money(b.amount_cents)} · ${b.description} has no ledger counterpart.`,
        suggestedAction: "Book as a new expense, or identify the missing ledger entry.",
        bankTxnId: b.id,
        evidence: [{ label: `Bank ${b.id}`, excerpt: `${b.posted_on} · ${money(b.amount_cents)} · ${b.description}` }],
      });
    }
  }

  // ── leftovers on the ledger side ────────────────────────────────────────────
  for (const gid of residue.glIds) {
    const g = glById.get(gid);
    if (!g) continue;
    drafts.push({
      category: "unmatched_gl",
      severity: g.doc_type === "journal" ? "low" : "medium",
      summary: `${g.booked_on} · ${money(g.amount_cents)} · ${g.memo} (acct ${g.account_code}) has no cash movement.`,
      suggestedAction:
        g.doc_type === "journal"
          ? "Likely an accrual — carry forward to next period."
          : "Chase the payment or confirm the entry was booked in error.",
      glEntryId: g.id,
      evidence: [{ label: `Ledger ${g.id}`, excerpt: `${g.booked_on} · ${money(g.amount_cents)} · ${g.memo} (acct ${g.account_code})` }],
    });
  }

  // ── conditions attached to matches we *did* make ────────────────────────────
  for (const p of proposals) {
    const banks = p.bankTxnIds.map((x) => bankById.get(x)).filter(Boolean) as BankTxn[];
    const gls = p.glEntryIds.map((x) => glById.get(x)).filter(Boolean) as GlEntry[];
    if (!banks.length || !gls.length) continue;

    const bankSum = banks.reduce((s, b) => s + b.amount_cents, 0);
    const glSum = gls.reduce((s, g) => s + g.amount_cents, 0);
    const crossCcy = banks.some((b) => gls.some((g) => g.currency !== b.currency));

    if (crossCcy) {
      drafts.push({
        category: "fx_variance",
        severity: "medium",
        summary: `${gls[0].currency} ${money(glSum)} settled as ${banks[0].currency} ${money(bankSum)} — implied rate ${(Math.abs(bankSum) / Math.abs(glSum || 1)).toFixed(4)}.`,
        suggestedAction: "Post the difference to realised FX gain/loss.",
        matchId: p.matchId, bankTxnId: banks[0].id, glEntryId: gls[0].id, evidence: p.evidence,
      });
    } else if (bankSum !== glSum) {
      drafts.push({
        category: "amount_variance",
        severity: Math.abs(bankSum - glSum) > 50_000 ? "high" : "low",
        summary: `Matched, but the bank settled ${money(Math.abs(bankSum - glSum))} away from the ledger amount (${money(glSum)} booked, ${money(bankSum)} cleared).`,
        suggestedAction: "Post the difference as a bank fee, or query the shortfall.",
        matchId: p.matchId, bankTxnId: banks[0].id, glEntryId: gls[0].id, evidence: p.evidence,
      });
    }

    if (p.confidence < CONFIDENCE.AUTO_POST && p.confidence >= CONFIDENCE.REVIEW_FLOOR) {
      drafts.push({
        category: "low_confidence",
        severity: p.confidence < 0.6 ? "medium" : "low",
        summary: `Proposed at ${(p.confidence * 100).toFixed(0)}% by ${p.method}${p.model ? ` (${p.model})` : ""}: ${p.reasoning}`,
        suggestedAction: "Confirm the pairing, or reassign to a different candidate.",
        matchId: p.matchId, bankTxnId: banks[0].id, glEntryId: gls[0].id, evidence: p.evidence,
      });
    }
  }

  // ── three-way match: invoice against purchase order and goods receipt ───────
  const threeWay = d
    .prepare(
      `SELECT i.invoice_no, i.vendor, i.amount_cents AS inv_amt, i.source_uri,
              p.po_no, p.amount_cents AS po_amt,
              COALESCE(SUM(r.amount_cents), 0) AS recv_amt
         FROM invoice i
         JOIN purchase_order p ON p.po_no = i.po_no
         LEFT JOIN goods_receipt r ON r.po_no = i.po_no
        WHERE i.po_no IS NOT NULL
        GROUP BY i.id`
    )
    .all() as {
      invoice_no: string; vendor: string; inv_amt: number;
      po_no: string; po_amt: number; recv_amt: number; source_uri: string;
    }[];

  for (const t of threeWay) {
    if (t.inv_amt <= t.recv_amt) continue;
    const over = t.inv_amt - t.recv_amt;
    drafts.push({
      category: "three_way_variance",
      severity: over > t.recv_amt * 0.1 ? "high" : "medium",
      summary: `${t.invoice_no} from ${t.vendor} bills ${money(t.inv_amt)} against ${t.po_no} but only ${money(t.recv_amt)} was received — over-billed by ${money(over)} (${((over / (t.recv_amt || 1)) * 100).toFixed(1)}%).`,
      suggestedAction: "Hold payment and raise a query with the vendor.",
      // The three documents side by side are the whole argument here. Without
      // them a reviewer has to go and find the PO themselves, which is the work
      // this queue exists to remove.
      evidence: [
        { label: `Invoice ${t.invoice_no}`, excerpt: `${t.vendor} · billed ${money(t.inv_amt)}`, source_uri: t.source_uri },
        { label: `Purchase order ${t.po_no}`, excerpt: `authorised ${money(t.po_amt)}` },
        { label: "Goods receipt", excerpt: `received ${money(t.recv_amt)} against ${t.po_no}` },
        { label: "Variance", excerpt: `Invoice exceeds what was received by ${money(over)} — ${((over / (t.recv_amt || 1)) * 100).toFixed(1)}% over` },
      ],
    });
  }

  // ── persist ─────────────────────────────────────────────────────────────────
  const ins = d.prepare(
    `INSERT INTO exception (id, run_id, match_id, bank_txn_id, gl_entry_id, evidence_json,
                            category, severity, summary, suggested_action, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'open',?)`
  );
  d.transaction(() => {
    for (const x of drafts) {
      ins.run(
        id("exc"), runId, x.matchId ?? null, x.bankTxnId ?? null, x.glEntryId ?? null,
        x.evidence ? JSON.stringify(x.evidence) : null,
        x.category, x.severity, x.summary, x.suggestedAction, nowIso()
      );
    }
  })();

  const byCategory = drafts.reduce<Record<string, number>>((acc, x) => {
    acc[x.category] = (acc[x.category] ?? 0) + 1;
    return acc;
  }, {});
  audit({ runId, actor: "agent:exceptions", action: "exceptions.built", detail: { total: drafts.length, byCategory } });

  return drafts.length;
}
