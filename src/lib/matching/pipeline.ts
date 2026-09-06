import { db, id, nowIso } from "../db";
import { audit } from "../audit";
import { startTrace, span } from "../trace";
import { CONFIDENCE, type BankTxn, type GlEntry, type MatchProposal, type RunStats } from "../types";
import type { Side } from "./normalize";
import { runRuleMatchers } from "./rules";
import { runLlmMatcher } from "./llm";
import { buildExceptions } from "../exceptions";

/**
 * The reconciliation run. Deliberately a fixed, readable sequence rather than a
 * free-roaming agent loop: in finance, a reviewer has to be able to explain why
 * the system did what it did, and a deterministic spine is what makes the LLM's
 * contribution auditable.
 *
 * Tier 1 (rules)  -> cheap, certain, carries the volume
 * Tier 2 (LLM)    -> only the residue, structured output, cited evidence
 * Tier 3 (gate)   -> confidence decides auto-post vs. human queue
 * Tier 4 (except) -> everything unresolved becomes a *typed* exception
 */
export async function runReconciliation(period = "2026-08"): Promise<{ runId: string; stats: RunStats }> {
  const t0 = Date.now();
  const runId = id("run");
  const traceId = startTrace("reconciliation", { runId, period });
  const d = db();

  d.prepare(`INSERT INTO run (id, started_at, period, trace_id) VALUES (?, ?, ?, ?)`)
    .run(runId, nowIso(), period, traceId);
  audit({ runId, actor: "agent:orchestrator", action: "run.started", detail: { period }, traceId });

  const bank = d.prepare(`SELECT * FROM bank_txn ORDER BY posted_on, id`).all() as BankTxn[];
  const gl = d.prepare(`SELECT * FROM gl_entry ORDER BY booked_on, id`).all() as GlEntry[];
  const side: Side = { bank, gl };

  // ---- tier 1: deterministic ----
  const s1 = span(traceId, "rules", { bank: bank.length, gl: gl.length });
  const ruleResult = runRuleMatchers(side);
  s1.end({ matched: ruleResult.proposals.length, residueBank: ruleResult.residue.bankIds.length });
  audit({
    runId, actor: "agent:matcher", action: "rules.completed", traceId,
    detail: { proposals: ruleResult.proposals.length, residue: ruleResult.residue },
  });

  // ---- tier 2: LLM, on the residue only ----
  const residueSide: Side = {
    bank: bank.filter((b) => ruleResult.residue.bankIds.includes(b.id)),
    gl: gl.filter((g) => ruleResult.residue.glIds.includes(g.id)),
  };
  const s2 = span(traceId, "llm", { bank: residueSide.bank.length, gl: residueSide.gl.length });
  const llmResult = await runLlmMatcher(residueSide, traceId);
  s2.end({ matched: llmResult.proposals.length, cost: llmResult.costUsd });
  audit({
    runId, actor: "agent:matcher", action: "llm.completed", traceId,
    detail: { proposals: llmResult.proposals.length, calls: llmResult.llmCallCount, costUsd: llmResult.costUsd },
  });

  // ---- tier 3: confidence gate ----
  const all = [...ruleResult.proposals, ...llmResult.proposals];
  let autoMatched = 0;
  let pendingReview = 0;
  for (const p of all) {
    if (p.confidence < CONFIDENCE.REVIEW_FLOOR) continue; // too weak to even propose
    const status = p.confidence >= CONFIDENCE.AUTO_POST ? "auto_posted" : "pending_review";
    persistMatch(runId, p, status);
    status === "auto_posted" ? autoMatched++ : pendingReview++;
  }

  // ---- tier 4: typed exceptions for everything left over ----
  const exceptionCount = buildExceptions(runId, llmResult.residue, all);

  const wallMs = Date.now() - t0;
  const stats: RunStats = {
    totalBankTxns: bank.length,
    totalGlEntries: gl.length,
    autoMatched,
    pendingReview,
    unmatched: llmResult.residue.bankIds.length + llmResult.residue.glIds.length,
    autoMatchRate: bank.length ? autoMatched / bank.length : 0,
    llmCallCount: llmResult.llmCallCount,
    costUsd: llmResult.costUsd,
    wallMs,
  };

  d.prepare(`UPDATE run SET finished_at = ?, stats_json = ? WHERE id = ?`)
    .run(nowIso(), JSON.stringify(stats), runId);
  audit({ runId, actor: "agent:orchestrator", action: "run.finished", detail: { ...stats, exceptionCount }, traceId });

  return { runId, stats };
}

function persistMatch(runId: string, p: MatchProposal, status: string): string {
  const d = db();
  const matchId = id("mch");
  d.prepare(
    `INSERT INTO match (id, run_id, kind, status, confidence, method, model, reasoning, evidence_json, cost_usd, latency_ms, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    matchId, runId, p.kind, status, p.confidence, p.method, p.model ?? null,
    p.reasoning, JSON.stringify(p.evidence ?? []), p.costUsd ?? 0, p.latencyMs ?? 0, nowIso()
  );

  const line = d.prepare(
    `INSERT INTO match_line (match_id, entity_type, entity_id, amount_cents) VALUES (?,?,?,?)`
  );
  const amountOf = (t: "bank_txn" | "gl_entry", eid: string) =>
    (d.prepare(
      t === "bank_txn"
        ? `SELECT amount_cents FROM bank_txn WHERE id = ?`
        : `SELECT amount_cents FROM gl_entry WHERE id = ?`
    ).get(eid) as { amount_cents: number } | undefined)?.amount_cents ?? 0;

  for (const b of p.bankTxnIds) line.run(matchId, "bank_txn", b, amountOf("bank_txn", b));
  for (const g of p.glEntryIds) line.run(matchId, "gl_entry", g, amountOf("gl_entry", g));

  audit({
    runId, actor: p.method === "llm" ? "agent:matcher:llm" : "agent:matcher:rules",
    action: `match.${status}`, entityType: "match", entityId: matchId,
    detail: { confidence: p.confidence, method: p.method, model: p.model },
  });
  return matchId;
}
