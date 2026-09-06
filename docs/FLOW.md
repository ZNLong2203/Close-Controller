# Flow

## Run lifecycle

A run is one reconciliation pass over a period. It is idempotent per period:
re-running rebuilds matches and exceptions from the source documents.

```
POST /api/run { period: "2026-08" }
  │
  ├─ INSERT run  · audit: run.started
  │
  ├─ load bank_txn + gl_entry
  │
  ├─ Tier 1  runRuleMatchers(side)
  │     └─ audit: rules.completed { proposals, residue }
  │
  ├─ Tier 2  runLlmMatcher(residue, traceId)          ← Neatlogs span per call
  │     └─ audit: llm.completed { calls, costUsd, modelBreakdown }
  │
  ├─ Tier 3  for each proposal
  │     conf < 0.45  → discarded, falls through to residue
  │     conf < 0.90  → status pending_review
  │     conf ≥ 0.90  → status auto_posted
  │     └─ audit: match.<status> per match
  │
  ├─ Tier 4  buildExceptions(residue, proposals)
  │
  └─ UPDATE run stats · audit: run.finished
```

## Exception lifecycle

Every unresolved thing becomes a typed exception. Nine categories, each with a
suggested action the reviewer can take in one click.

| Category | Raised when | Suggested action |
|---|---|---|
| `unmatched_bank` | Bank line with no ledger counterpart | Book as a new expense |
| `unmatched_gl` | Ledger entry with no cash movement | Carry as accrual to next period |
| `amount_variance` | Matched, amounts differ | Post the difference as a bank fee |
| `duplicate_suspect` | Two bank legs share a reference, one ledger entry | Flag for vendor recovery |
| `timing_difference` | Matched across a period boundary | Accept, note the lag |
| `fx_variance` | Matched across currencies | Post an FX gain/loss line |
| `low_confidence` | Proposal between 0.45 and 0.90 | Confirm or reassign |
| `policy_block` | Policy engine refused a posting | Review the blocking rule |
| `three_way_variance` | Invoice exceeds goods receipt for a PO | Hold payment, query vendor |

```
   open ──▶ reviewer opens item
             │  side-by-side evidence: bank line │ ledger candidate
             │  agent reasoning + the exact fields it cited
             │
             ├─ Approve  ─▶ evaluatePolicy()
             │                ├─ clean  ─▶ journal_entry posted   ─▶ resolved
             │                └─ block  ─▶ journal_entry blocked  ─▶ stays open,
             │                             policy_violation row,   reason shown inline
             ├─ Reject   ─▶ dismissed
             └─ Reassign ─▶ match rebuilt against a different candidate
```

Every transition writes an `audit_event` with `actor: 'human:<name>'`. Agent
decisions and human decisions land in the same log, in the same shape — which
is what makes the export usable as audit support rather than as a changelog.

## The guardrail path

Policy runs twice: once before an auto-post, and again when a human clicks
approve. The second is not redundant. A reviewer approving a duplicate payment
at the end of a long close is precisely the case the check exists for, and a
system that only validates its own actions has no answer for it.

A blocked entry is persisted with `status = 'blocked'` and a `policy_violation`
row. It is never silently dropped — a refusal you cannot point at is
indistinguishable from a bug.
