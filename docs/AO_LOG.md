# AO Session Log

Evidence of how this project was built. One row per worker session.

| # | Session / branch | Agent | Task | Outcome |
|---|---|---|---|---|
| 1 | bootstrap | Claude Code | Schema, db layer, ground-truth fixture generator, interface contracts | merged |
| 2 | docs | Claude Code | Public architecture and flow docs; Gemini swap; private/ split | merged |
| 3 | worker-a | Claude Code | Deterministic matcher — normalisation, similarity, five passes | merged |
| 4 | fixture-hardening | Claude Code | Added semantically-hard cases after the rule tier scored 100% and left the LLM tier with nothing to do | merged |
| 5 | worker-b | Claude Code | Gemini tier — batching, structured output, id validation, two-tier routing | merged |
| 6 | worker-d | Claude Code | Typed exception builder, policy engine, journal posting, review loop | merged |
| 7 | worker-e | Claude Code | Eval harness with baseline comparison | merged |
| 8 | worker-c | Claude Code | Review UI — dashboard, exception queue with evidence panel, audit trail | merged |

## What parallelism required

Interface contracts were written and committed **before** any implementation
(commit `a886a21`), with file ownership assigned per worker. That is what let
workers run concurrently without merge conflicts: no worker ever needed to edit
a file another worker owned.

The one place the plan had to change was session 4. The deterministic tier
scored precision 1.0 and recall 1.0 on the original fixture, which meant the
LLM tier had no honest work — an architecture that looks good in a diagram and
proves nothing. Rather than weaken the rules, the fixture gained cases that are
unreachable by string normalisation: vendor trading names, free-text ledger
memos, processor payouts covering several receivables, and human-transposed
references.

<!-- Screenshot the AO Kanban before recording — the total session count is an
     explicit judging item. -->
