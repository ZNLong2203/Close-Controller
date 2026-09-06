# Results

> Populated by `npm run eval`. Worker E owns this file.

The eval harness scores a reconciliation run against the `ground_truth` table —
168 labelled rows across 10 real failure modes, written by the fixture generator
and never by the agent.

`npm run eval --baseline` disables the deterministic tier and routes every
transaction through the model, producing the comparison column.

| Metric | Baseline (LLM-only) | Close Controller |
|---|---|---|
| Match precision | — | — |
| Match recall | — | — |
| Match F1 | — | — |
| Auto-match rate | — | — |
| Human-review rate | — | — |
| **False auto-posts** | — | — |
| Exception detection precision | — | — |
| Exception detection recall | — | — |
| LLM calls | — | — |
| Cost (USD) | — | — |
| Cost per 1,000 txns | — | — |
| p50 / p95 latency | — | — |
| Wall time | — | — |

**False auto-posts** — matches booked without human review that ground truth says
are wrong — is the number that matters. Every other metric can be traded off
against cost; this one cannot.

## Per-category exception detection

| Category | Expected | Detected | Precision | Recall |
|---|---|---|---|---|
| `unmatched_bank` | 7 | — | — | — |
| `unmatched_gl` | 6 | — | — | — |
| `amount_variance` | 6 | — | — | — |
| `duplicate_suspect` | 4 | — | — | — |
| `fx_variance` | 5 | — | — | — |
| `three_way_variance` | 2 | — | — | — |
