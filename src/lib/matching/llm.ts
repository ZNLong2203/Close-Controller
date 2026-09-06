import type { MatchProposal } from "../types";
import type { Side } from "./normalize";

/**
 * LLM tier. Only ever sees what the rules could not place, which is the whole
 * cost argument: we spend tokens on ambiguity, not on volume.
 *
 * WORKER B owns this file.
 *
 * Requirements:
 *  - Batch the residue; do not issue one request per transaction.
 *  - Route by difficulty: claude-sonnet-5 by default, escalate a candidate set
 *    to claude-opus-5 only when sonnet returns confidence < 0.6. Record which
 *    model decided in MatchProposal.model.
 *  - Return structured output (tool use / JSON schema), never free text.
 *  - Populate `evidence` with the concrete fields that drove the decision so
 *    the review UI can show a human why. An unexplained match is unusable.
 *  - Accumulate real token cost into MatchProposal.costUsd.
 *  - Wrap each call in a Neatlogs span (see ../trace).
 */
export interface LlmTierResult {
  proposals: MatchProposal[];
  residue: { bankIds: string[]; glIds: string[] };
  llmCallCount: number;
  costUsd: number;
}

export async function runLlmMatcher(_side: Side, _traceId: string): Promise<LlmTierResult> {
  throw new Error("TODO(worker-b): runLlmMatcher");
}
