# Architecture

## The shape of the problem

Reconciliation is not one task. It is a long tail of failure modes wearing the
same costume — two rows that should have been one. Some of that tail is
mechanical and some of it needs judgement, and the engineering question is
knowing which is which *before* you spend a model call on it.

So the system is tiered by certainty, cheapest first.

```
                bank_txn (160)          gl_entry (147)
                      \                    /
                       \                  /
              ┌─────────────────────────────────────┐
   Tier 1     │  Deterministic rules                │   ~70% of volume
              │  exact ref · same-day · fuzzy       │   cost: $0
              │  subset-sum · duplicate detection   │   confidence 0.70-0.99
              └─────────────────────────────────────┘
                              │ residue only
              ┌─────────────────────────────────────┐
   Tier 2     │  Gemini tier                        │   ~20% of volume
              │  flash-lite → flash on low conf.    │   structured output
              │  batched by vendor, cited evidence  │   validated ids
              └─────────────────────────────────────┘
                              │ proposals
              ┌─────────────────────────────────────┐
   Tier 3     │  Confidence gate                    │
              │  ≥0.90 auto-post   <0.90 → human    │
              │  <0.45 not proposed at all          │
              └─────────────────────────────────────┘
                              │
              ┌─────────────────────────────────────┐
   Tier 4     │  Typed exception builder            │
              │  9 categories, each with a          │
              │  suggested one-click action         │
              └─────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │  Policy engine    │  refuses to post: unbalanced entries,
                    │  block / warn     │  duplicate payments, closed periods,
                    └─────────┬─────────┘  auto-posts above the approval limit
                              │
                     journal_entry + audit_event
```

## Why a fixed spine instead of an agent loop

An agent that plans its own reconciliation strategy is more impressive to
describe and worse to defend. Three reasons this one does not:

- **Explainability is the product.** A reviewer signing off on a close needs to
  say why a match was made. "The orchestrator chose to investigate" is not a
  reason a controller can put in front of an auditor; "reference INV-9001
  matched on both sides, amounts identical to the cent" is.
- **Cost is bounded.** A loop that decides how many calls to make has no ceiling
  on cost per close. A tiered pipeline's LLM spend is a function of how much the
  rules failed to place — a number you can measure and drive down.
- **Regressions are visible.** Because the spine is fixed, a change to any tier
  shows up as a delta in the eval table. That is what makes
  [RESULTS.md](RESULTS.md) meaningful rather than decorative.

The LLM is not the system. It is the component that handles the residue the
deterministic layer honestly cannot, and it is scoped so its failures are
contained and reviewable.

## Components

| Module | Responsibility |
|---|---|
| `src/lib/matching/normalize.ts` | Vendor canonicalisation, reference extraction, similarity |
| `src/lib/matching/rules.ts` | Tier 1 — deterministic passes, most-certain first |
| `src/lib/matching/llm.ts` | Tier 2 — Gemini, batched, structured, id-validated |
| `src/lib/matching/pipeline.ts` | The spine; owns run lifecycle and the confidence gate |
| `src/lib/exceptions.ts` | Tier 4 — turns residue into a typed, actionable queue |
| `src/lib/policy/guardrails.ts` | Pre-posting policy checks, block vs. warn |
| `src/lib/posting.ts` | Approved match → balanced journal entry |
| `src/lib/audit.ts` | Append-only decision log, agent and human alike |
| `src/lib/export/*` | Read models + RFC 4180 writer behind the three CSV exports |
| `src/lib/trace.ts` | Local JSONL spans, used for the latency percentiles in the eval |
| `src/lib/neatlogs.ts` | Neatlogs tracing — wraps the Gemini client so every call is a span; no-op when unconfigured |

## Data model

Twelve tables in SQLite. Money is **integer cents everywhere** — no float ever
touches a monetary value.

The three that carry the design:

- **`match` + `match_line`** — a match is a *claim* that a set of bank
  transactions corresponds to a set of ledger entries. Modelling it as two
  tables rather than a foreign key is what makes one-to-many real: a bill
  settled by two partial payments is one match with three lines, not two
  half-truths.
- **`exception`** — carries a category, a severity and a `suggested_action`.
  A flat "unmatched" list is not a deliverable; a reviewer needs to know which
  pile a row is in and what to do about it.
- **`ground_truth`** — written only by the fixture generator, never by the
  agent. It is what turns "the demo worked" into a precision number.

## Model routing

`gemini-3.5-flash-lite` handles the residue. Only candidates it returns with
confidence below 0.6 are re-run on `gemini-3.8-flash`. Both the deciding model
and the per-model call split are recorded, so the routing shows up in the eval
output as a cost line rather than an unverified claim.
