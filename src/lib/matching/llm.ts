import { GoogleGenAI, Type } from "@google/genai";
import type { BankTxn, EvidenceItem, GlEntry, MatchProposal } from "../types";
import { span } from "../trace";
import type { Side } from "./normalize";

/**
 * LLM tier, backed by the Gemini API.
 *
 * It only ever sees what the deterministic rules could not place. That is the
 * whole cost argument — tokens go to ambiguity, not to volume — and it is also
 * what keeps the model's failures contained: it cannot break a match the rules
 * already made with certainty.
 */

export interface LlmTierResult {
  proposals: MatchProposal[];
  residue: { bankIds: string[]; glIds: string[] };
  llmCallCount: number;
  costUsd: number;
  modelBreakdown: Record<string, number>;
}

const FAST = process.env.GEMINI_MODEL_FAST ?? "gemini-3.5-flash-lite";
const STRONG = process.env.GEMINI_MODEL_STRONG ?? "gemini-3.8-flash";

/** USD per million tokens, from ai.google.dev/pricing (verified 2026-09-06). */
const RATES: Record<string, { in: number; out: number }> = {
  "gemini-3.5-flash-lite": { in: 0.30, out: 2.50 },
  "gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "gemini-3.5-flash": { in: 1.50, out: 9.00 },
};

const BANK_BATCH = 12;
/** Below this the fast tier is not trusted and the candidate is re-run on the strong model. */
const ESCALATE_BELOW = 0.6;

const money = (c: number) => `${c < 0 ? "-" : ""}$${Math.abs(c / 100).toFixed(2)}`;

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    proposals: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          bankTxnIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          glEntryIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING },
          signal: { type: Type.STRING },
        },
        required: ["bankTxnIds", "glEntryIds", "confidence", "reasoning", "signal"],
      },
    },
  },
  required: ["proposals"],
};

const SYSTEM = `You reconcile bank transactions against general-ledger entries for a month-end close.

You are the second tier. Deterministic rules have already matched everything with a
shared reference, an identical same-day amount, or a close vendor-name match. What
reaches you is the residue: pairs that are the same economic event but do not look
alike on the surface, and rows that genuinely have no counterpart.

The residue typically contains:
- A vendor trading under an abbreviated or different name on the bank statement
  ("ACME CLOUD SVCS" for "Acme Cloud Services").
- A ledger memo describing what the spend was for rather than who it was to
  ("Q3 retainer - outside counsel" against a payment to a law firm).
- A payment-processor payout: one bank deposit settling several unrelated
  customer invoices at once. Pair the single bank line with ALL the ledger
  entries whose amounts sum to it.
- A reference mistyped by a human ("INV-S2O1" for "INV-5201").
- Rows with no counterpart at all: unrecorded bank charges, and accruals that
  will not settle until next period.

Rules you must follow:
- Only use ids exactly as given. Never invent, correct, or reformat an id.
- Amounts are in integer cents. Signs matter: a negative bank amount is money
  leaving the account and can only pair with ledger entries of the same sign.
- Leaving a row unmatched is a correct answer and is much better than a wrong
  pairing. A false match costs a controller more time than an unmatched row.
- Every proposal needs a reasoning that names the concrete fields you used. A
  match a reviewer cannot verify in a few seconds is not useful.

Calibrate confidence honestly:
  0.95+  the amounts agree exactly and the semantic link is unambiguous
  0.75+  strong link, one soft element (a date gap, a small amount difference)
  0.50+  plausible, a human should confirm
  below  do not propose it at all`;

function renderBank(t: BankTxn): string {
  return `${t.id} | ${t.posted_on} | ${money(t.amount_cents)} ${t.currency} | ${t.description}${t.counterparty ? ` | party: ${t.counterparty}` : ""}${t.external_ref ? ` | ref: ${t.external_ref}` : ""}`;
}
function renderGl(g: GlEntry): string {
  return `${g.id} | ${g.booked_on} | ${money(g.amount_cents)} ${g.currency} | acct ${g.account_code} | ${g.memo}${g.vendor ? ` | vendor: ${g.vendor}` : ""}${g.doc_ref ? ` | ref: ${g.doc_ref}` : ""}`;
}

interface RawProposal {
  bankTxnIds: string[];
  glEntryIds: string[];
  confidence: number;
  reasoning: string;
  signal: string;
}

export async function runLlmMatcher(side: Side, traceId: string): Promise<LlmTierResult> {
  const empty: LlmTierResult = {
    proposals: [],
    residue: { bankIds: side.bank.map((b) => b.id), glIds: side.gl.map((g) => g.id) },
    llmCallCount: 0,
    costUsd: 0,
    modelBreakdown: {},
  };

  if (process.env.CC_SKIP_LLM === "1") return empty;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[llm] GEMINI_API_KEY not set — skipping the LLM tier. Rules-only results follow.");
    return empty;
  }
  if (!side.bank.length || !side.gl.length) return empty;

  const ai = new GoogleGenAI({ apiKey });
  const bankById = new Map(side.bank.map((b) => [b.id, b]));
  const glById = new Map(side.gl.map((g) => [g.id, g]));

  let calls = 0;
  let cost = 0;
  const breakdown: Record<string, number> = {};

  const ask = async (model: string, bank: BankTxn[], label: string): Promise<RawProposal[]> => {
    const s = span(traceId, `gemini.${label}`, { model, bankLines: bank.length, glCandidates: side.gl.length });
    const prompt = [
      `BANK TRANSACTIONS (${bank.length}) — find a counterpart for each, or leave it unmatched:`,
      bank.map(renderBank).join("\n"),
      "",
      `LEDGER CANDIDATES (${side.gl.length}) — a candidate may be used by at most one proposal:`,
      side.gl.map(renderGl).join("\n"),
    ].join("\n");

    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0,
          // The fast tier is doing recognition, not deliberation. Paying for
          // reasoning tokens here would erase the reason it is the fast tier.
          ...(model === FAST ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });

      calls++;
      breakdown[model] = (breakdown[model] ?? 0) + 1;
      const u = res.usageMetadata;
      const rate = RATES[model] ?? RATES[FAST];
      const callCost =
        ((u?.promptTokenCount ?? 0) / 1e6) * rate.in +
        ((u?.candidatesTokenCount ?? 0) / 1e6) * rate.out;
      cost += callCost;

      const parsed = JSON.parse(res.text ?? "{}") as { proposals?: RawProposal[] };
      const out = parsed.proposals ?? [];
      s.end({ proposals: out.length }, { costUsd: callCost, tokens: u?.totalTokenCount });
      return out;
    } catch (err) {
      // A failed batch must not fail the close. Those rows stay in the residue
      // and surface as exceptions, which is the correct conservative outcome.
      s.end({ error: String(err) });
      console.warn(`[llm] ${label} on ${model} failed: ${String(err)}`);
      return [];
    }
  };

  // ── fast tier over the whole residue, batched ───────────────────────────────
  const batches: BankTxn[][] = [];
  for (let i = 0; i < side.bank.length; i += BANK_BATCH) batches.push(side.bank.slice(i, i + BANK_BATCH));

  const fastRaw: RawProposal[] = [];
  for (const [i, batch] of batches.entries()) {
    fastRaw.push(...(await ask(FAST, batch, `fast.batch${i + 1}`)));
  }

  const valid = (r: RawProposal) =>
    r.bankTxnIds?.length > 0 &&
    r.glEntryIds?.length > 0 &&
    r.bankTxnIds.every((x) => bankById.has(x)) &&
    r.glEntryIds.every((x) => glById.has(x));

  // Hallucinated ids are dropped outright rather than repaired — a match that
  // points at a row that does not exist is not a near miss, it is noise.
  const dropped = fastRaw.filter((r) => !valid(r)).length;
  if (dropped) console.warn(`[llm] dropped ${dropped} proposal(s) referencing unknown ids`);

  const kept = fastRaw.filter(valid);
  const model: Record<string, string> = {};
  for (const r of kept) for (const b of r.bankTxnIds) model[b] = FAST;

  // ── escalate only what the fast tier was unsure about ───────────────────────
  const shaky = kept.filter((r) => r.confidence < ESCALATE_BELOW);
  const shakyBankIds = new Set(shaky.flatMap((r) => r.bankTxnIds));
  let finalRaw = kept.filter((r) => r.confidence >= ESCALATE_BELOW);

  if (shakyBankIds.size) {
    const retryBank = side.bank.filter((b) => shakyBankIds.has(b.id));
    const strongRaw = (await ask(STRONG, retryBank, "strong.escalation")).filter(valid);
    for (const r of strongRaw) for (const b of r.bankTxnIds) model[b] = STRONG;
    finalRaw = [...finalRaw, ...strongRaw.filter((r) => r.confidence >= ESCALATE_BELOW)];
  }

  // ── resolve contention ──────────────────────────────────────────────────────
  // Batches each saw the full candidate list, so two of them can claim the same
  // ledger entry. Highest confidence wins; the loser goes back to the residue.
  const claimedBank = new Set<string>();
  const claimedGl = new Set<string>();
  const proposals: MatchProposal[] = [];

  for (const r of [...finalRaw].sort((a, b) => b.confidence - a.confidence)) {
    if (r.bankTxnIds.some((x) => claimedBank.has(x))) continue;
    if (r.glEntryIds.some((x) => claimedGl.has(x))) continue;

    const banks = r.bankTxnIds.map((x) => bankById.get(x)!);
    const gls = r.glEntryIds.map((x) => glById.get(x)!);

    // Sign discipline is not something we delegate to the model.
    const bankSum = banks.reduce((s, b) => s + b.amount_cents, 0);
    const glSum = gls.reduce((s, g) => s + g.amount_cents, 0);
    if (bankSum !== 0 && glSum !== 0 && bankSum > 0 !== glSum > 0) continue;

    r.bankTxnIds.forEach((x) => claimedBank.add(x));
    r.glEntryIds.forEach((x) => claimedGl.add(x));

    const evidence: EvidenceItem[] = [
      ...banks.map((b) => ({ label: `Bank ${b.id}`, excerpt: renderBank(b) })),
      ...gls.map((g) => ({ label: `Ledger ${g.id}`, excerpt: renderGl(g) })),
      { label: "Signal", excerpt: r.signal },
    ];
    if (bankSum !== glSum) {
      evidence.push({ label: "Amount variance", excerpt: `Bank ${money(bankSum)} vs ledger ${money(glSum)} — gap ${money(Math.abs(bankSum - glSum))}` });
    }

    proposals.push({
      kind: "bank_gl",
      bankTxnIds: r.bankTxnIds,
      glEntryIds: r.glEntryIds,
      confidence: Math.max(0, Math.min(1, r.confidence)),
      method: "llm",
      model: model[r.bankTxnIds[0]] ?? FAST,
      reasoning: r.reasoning,
      evidence,
    });
  }

  const totalCost = Math.round(cost * 1e6) / 1e6;
  if (proposals.length) {
    const per = totalCost / proposals.length;
    for (const p of proposals) p.costUsd = per;
  }

  return {
    proposals,
    residue: {
      bankIds: side.bank.filter((b) => !claimedBank.has(b.id)).map((b) => b.id),
      glIds: side.gl.filter((g) => !claimedGl.has(g.id)).map((g) => g.id),
    },
    llmCallCount: calls,
    costUsd: totalCost,
    modelBreakdown: breakdown,
  };
}
