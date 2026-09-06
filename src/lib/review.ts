import { db, id, nowIso } from "./db";
import { audit } from "./audit";
import { postMatch, type PostResult } from "./posting";
import type { BankTxn, GlEntry } from "./types";

/**
 * The human side of the loop.
 *
 * Everything a reviewer can do lands here, so agent decisions and human
 * decisions are recorded in the same shape and the audit export reads as one
 * story rather than two.
 */

export type ReviewAction = "approve" | "reject" | "dismiss" | "post_anyway";

export interface ReviewOutcome {
  exceptionId: string;
  action: ReviewAction;
  status: "resolved" | "dismissed" | "blocked";
  posting?: PostResult;
  message: string;
}

interface ExceptionRow {
  id: string;
  run_id: string;
  match_id: string | null;
  bank_txn_id: string | null;
  gl_entry_id: string | null;
  category: string;
  severity: string;
  summary: string;
  status: string;
}

export function decideException(
  exceptionId: string,
  action: ReviewAction,
  reviewer: string,
  note?: string
): ReviewOutcome {
  const d = db();
  const exc = d.prepare(`SELECT * FROM exception WHERE id = ?`).get(exceptionId) as ExceptionRow | undefined;
  if (!exc) throw new Error(`exception ${exceptionId} not found`);
  if (exc.status !== "open") throw new Error(`exception ${exceptionId} is already ${exc.status}`);

  const actor = `human:${reviewer}`;
  const close = (status: "resolved" | "dismissed", message: string) => {
    d.prepare(
      `UPDATE exception SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ? WHERE id = ?`
    ).run(status, actor, nowIso(), note ?? message, exceptionId);
  };

  audit({
    runId: exc.run_id, actor, action: `review.${action}`,
    entityType: "exception", entityId: exceptionId,
    detail: { category: exc.category, note },
  });

  switch (action) {
    case "dismiss": {
      close("dismissed", "Acknowledged; no entry required.");
      return { exceptionId, action, status: "dismissed", message: "Dismissed." };
    }

    case "reject": {
      if (exc.match_id) {
        d.prepare(`UPDATE match SET status = 'rejected' WHERE id = ?`).run(exc.match_id);
      }
      close("resolved", "Pairing rejected by reviewer.");
      return { exceptionId, action, status: "resolved", message: "Pairing rejected; both sides returned to the queue." };
    }

    case "approve": {
      if (!exc.match_id) {
        throw new Error(`exception ${exceptionId} has no proposed match to approve — use post_anyway to force an entry`);
      }
      d.prepare(`UPDATE match SET status = 'approved', method = 'human' WHERE id = ?`).run(exc.match_id);
      const posting = postMatch(exc.run_id, exc.match_id, "human", actor);
      if (posting.status === "blocked") {
        // The reviewer said yes and policy said no. Policy wins, and the
        // exception stays open — this is the whole point of checking human
        // approvals as well as the agent's own.
        return {
          exceptionId, action, status: "blocked", posting,
          message: posting.findings.filter((f) => f.severity === "block").map((f) => `${f.ruleCode}: ${f.message}`).join(" "),
        };
      }
      close("resolved", `Approved and posted as ${posting.jeId}.`);
      return { exceptionId, action, status: "resolved", posting, message: `Posted as ${posting.jeId}.` };
    }

    case "post_anyway": {
      // For exceptions with no proposed match — a suspected duplicate, say.
      // The reviewer is overriding the system's advice; policy still applies.
      if (!exc.bank_txn_id || !exc.gl_entry_id) {
        throw new Error(`exception ${exceptionId} has no bank/ledger pair to post`);
      }
      const b = d.prepare(`SELECT * FROM bank_txn WHERE id = ?`).get(exc.bank_txn_id) as BankTxn;
      const g = d.prepare(`SELECT * FROM gl_entry WHERE id = ?`).get(exc.gl_entry_id) as GlEntry;

      const matchId = id("mch");
      d.transaction(() => {
        d.prepare(
          `INSERT INTO match (id, run_id, kind, status, confidence, method, reasoning, evidence_json, created_at)
           VALUES (?,?,'bank_gl','approved',1.0,'human',?,?,?)`
        ).run(
          matchId, exc.run_id,
          `Forced by ${actor} against the system's advice: ${exc.summary}`,
          JSON.stringify([
            { label: `Bank ${b.id}`, excerpt: `${b.posted_on} · ${b.description}` },
            { label: `Ledger ${g.id}`, excerpt: `${g.booked_on} · ${g.memo}` },
          ]),
          nowIso()
        );
        d.prepare(`INSERT INTO match_line (match_id, entity_type, entity_id, amount_cents) VALUES (?,?,?,?)`)
          .run(matchId, "bank_txn", b.id, b.amount_cents);
        d.prepare(`INSERT INTO match_line (match_id, entity_type, entity_id, amount_cents) VALUES (?,?,?,?)`)
          .run(matchId, "gl_entry", g.id, g.amount_cents);
      })();

      const posting = postMatch(exc.run_id, matchId, "human", actor);
      if (posting.status === "blocked") {
        d.prepare(`UPDATE exception SET resolution_note = ? WHERE id = ?`)
          .run(`Posting refused: ${posting.findings.map((f) => f.ruleCode).join(", ")}`, exceptionId);
        return {
          exceptionId, action, status: "blocked", posting,
          message: posting.findings.filter((f) => f.severity === "block").map((f) => `${f.ruleCode}: ${f.message}`).join(" "),
        };
      }
      close("resolved", `Forced posting accepted as ${posting.jeId}.`);
      return { exceptionId, action, status: "resolved", posting, message: `Posted as ${posting.jeId}.` };
    }
  }
}
