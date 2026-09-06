import type { MatchProposal } from "../types";
import type { Side } from "./normalize";

/**
 * LLM tier, backed by the Gemini API (`@google/genai`).
 *
 * This tier only ever sees what the rules could not place, which is the whole
 * cost argument: tokens are spent on ambiguity, not on volume.
 *
 * WORKER B owns this file.
 *
 * Requirements:
 *  - `import { GoogleGenAI } from "@google/genai"`, keyed by `GEMINI_API_KEY`.
 *  - Two-tier routing, and it must be visible in the numbers:
 *      GEMINI_MODEL_FAST   (gemini-3.5-flash-lite) handles the residue by default
 *      GEMINI_MODEL_STRONG (gemini-3.8-flash) re-runs only the candidates the
 *      fast tier returned with confidence < 0.6
 *    Record which model decided in `MatchProposal.model`.
 *  - Batch the residue into grouped requests. One request per transaction is
 *    disqualifying on cost — group by vendor, then chunk.
 *  - Structured output only: pass `config.responseMimeType = "application/json"`
 *    and `config.responseSchema`. Never parse free text.
 *  - Every proposal carries `evidence` naming the concrete fields that drove it.
 *    A match a reviewer cannot verify is worse than no match.
 *  - Accumulate real token cost into `costUsd` from `usageMetadata` on each
 *    response; do not hardcode an estimate.
 *  - Wrap each call in a Neatlogs span (see ../trace).
 *
 * Hard rule: never let the model invent an id. Validate every returned
 * bankTxnId / glEntryId against the residue you passed in, and drop proposals
 * that reference anything else.
 */
export interface LlmTierResult {
  proposals: MatchProposal[];
  residue: { bankIds: string[]; glIds: string[] };
  llmCallCount: number;
  costUsd: number;
  /** call counts per model, so the eval harness can show the routing split */
  modelBreakdown: Record<string, number>;
}

export async function runLlmMatcher(_side: Side, _traceId: string): Promise<LlmTierResult> {
  throw new Error("TODO(worker-b): runLlmMatcher");
}
