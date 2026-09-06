# AO Worker Specs

Five independent tasks. Each owns a disjoint set of files, so all five can run as
parallel AO workers on their own branches without merge conflicts. Interfaces are
already fixed in the repo — implement against them, do not change the signatures.

Ground rules for every worker:
- `npm run seed` gives you the fixture. `npx tsc --noEmit` must stay clean.
- Money is integer cents. Never use floats for money.
- Read `src/lib/types.ts` first; it is the contract.

---

## Worker A — Deterministic matcher
**Owns:** `src/lib/matching/normalize.ts`, `src/lib/matching/rules.ts`

Implement `normalizeCounterparty`, `extractRefs`, `similarity`, `daysBetween`, and
`runRuleMatchers`. The passes required are documented in `rules.ts`.

This tier decides the whole cost story: every pair it resolves is one the LLM
never sees. Target ≥70% of bank transactions placed by rules alone on the
`aug2026` fixture, with zero false matches on the duplicate-payment pairs — the
second leg of a duplicate must be left in the residue, not matched.

Watch for: subset-sum for partial payments must not be exponential; cap the
candidate window by vendor and date before searching.

---

## Worker B — LLM tier + Neatlogs tracing
**Owns:** `src/lib/matching/llm.ts`, `src/lib/trace.ts`

Implement `runLlmMatcher` per the contract, and make `src/lib/trace.ts` post real
spans to Neatlogs when `NEATLOGS_API_KEY` is set (silent no-op otherwise — the
pipeline must never fail because tracing is down).

Use `@google/genai` keyed by `GEMINI_API_KEY`. Two-tier routing:
`gemini-3.5-flash-lite` handles the residue, and only candidates it returns with
confidence < 0.6 are re-run on `gemini-3.8-flash`. Record the deciding model in
`MatchProposal.model` and return per-model call counts in `modelBreakdown` — the
eval harness reports the routing split. Batch the residue into grouped requests;
one request per transaction is disqualifying on cost.

Structured output only: `responseMimeType: "application/json"` plus a
`responseSchema`. Never parse free text. Every proposal must carry
`evidence` naming the concrete fields that drove it; a match a reviewer cannot
verify is worse than no match.

---

## Worker C — Review UI
**Owns:** `src/app/**`, `src/components/**`

Three screens, Tailwind, server components where possible:

1. **Run dashboard** — trigger a run, then show: auto-match rate, exceptions by
   category, LLM cost and call count, wall time. Numbers large and legible; this
   is what the demo video lingers on.
2. **Exception queue** — grouped by category, sorted by severity. Each row opens
   a side-by-side evidence panel: bank transaction on the left, GL candidate on
   the right, the agent's reasoning and cited fields underneath. Approve /
   Reject / Reassign, each writing an `audit_event` with `actor: 'human:...'`.
3. **Audit trail** — chronological, filterable by actor, exportable as CSV.

API routes: `POST /api/run`, `GET /api/exceptions`, `POST /api/exceptions/[id]/decide`.
Call `evaluatePolicy` on approve — a blocked entry must render the block reason
inline, in red, without navigating away. That moment is the demo's climax.

---

## Worker D — Policy guardrails + exception builder + posting
**Owns:** `src/lib/policy/guardrails.ts`, `src/lib/exceptions.ts`, `src/lib/posting.ts` (new)

Implement `evaluatePolicy` (rules listed in the file) and `buildExceptions`
(categories listed in the file). Add `src/lib/posting.ts` that turns an approved
match into a balanced `journal_entry` + `journal_line` set, running the policy
engine first and writing `policy_violation` rows for everything it finds —
including warnings that did not block.

A blocked entry is persisted with `status = 'blocked'`, never silently dropped.
The demo depends on being able to point at a row and say "the system refused."

---

## Worker E — Eval harness
**Owns:** `scripts/eval.ts`, `docs/RESULTS.md`

Score a run against the `ground_truth` table and print a table:

- match precision / recall / F1
- auto-match rate, human-review rate
- exception detection: per-category precision and recall against
  `expected_exception`
- **false auto-post count** — a match posted without review that ground truth
  says is wrong. This number must be zero; it is the one that matters in finance.
- LLM calls, cost USD, cost per 1,000 transactions, p50/p95 latency

Support `--baseline` (rules disabled, everything through the LLM) and write both
runs into `docs/RESULTS.md` as a before/after table. That table is the evidence
of "measurable improvement" the judging criteria asks for — it is worth more than
any feature.
