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

---

# Round 2 — remaining work

These three are independent and own disjoint files, so they run as parallel AO
workers. Read this first:

- **Hooks are installed.** `scripts/hooks/pre-commit` refuses any commit
  containing a credential; `scripts/hooks/commit-msg` requires Conventional
  Commits (`feat(scope): …`). A rejected commit is the hook working, not a bug.
- `npm run seed` builds the fixture, `npm run typecheck` must stay clean,
  `npm run eval` must still report **0 false auto-posts** when you are done.
- Money is integer cents everywhere. No floats touch a monetary value.

---

## Worker F — CSV ingestion
**Owns:** `src/app/import/**`, `src/lib/import/**`, `src/app/api/import/**`

Right now the system only runs against the seeded fixture. A judge asking "can I
run this on my own statement?" gets no for an answer, and that is the weakest
point in the whole submission.

Build an import flow:

1. **Upload** — a page at `/import` taking two CSVs: a bank statement and a
   general ledger export. Drag-and-drop or file picker, both fine.
2. **Column mapping** — real exports never share a schema. Parse the header row,
   guess the mapping (date / amount / description / reference / counterparty for
   bank; date / amount / account / memo / vendor / reference for ledger), and
   show the guess in editable dropdowns. The guess should handle the obvious
   synonyms: `Date`, `Transaction Date`, `Posted`, `Value Date`; `Amount`,
   `Debit`/`Credit` pairs, `Value`; and so on.
3. **Amount handling** — support both a single signed column and separate
   debit/credit columns. Strip currency symbols, thousands separators, and
   parentheses-for-negative. Parse to integer cents; never `parseFloat` into a
   money field.
4. **Preview** — first 10 rows as they will be inserted, with a count and the
   detected date range. Nothing is written until the user confirms.
5. **Import** — insert into `bank_txn` / `gl_entry`, then send the user to `/`
   to run a close. Write an `audit_event` recording who imported what and how
   many rows.

Reject rather than guess: an unparseable date or amount fails the row and is
reported in a rejected-rows list. Silently coercing bad financial data is worse
than refusing it.

Ship a couple of realistic sample CSVs in `data/samples/` so the flow can be
demonstrated without the fixture.

---

## Worker G — Test suite
**Owns:** `src/**/*.test.ts`, and a `test` script in `package.json`

Use `node:test` and `node:assert/strict` — built into Node 22, no new
dependency. Add `"test": "tsx --test src/**/*.test.ts"` to package.json.

The credibility problem this solves: the same author wrote the fixture and the
matcher, so the eval scoring 100% precision proves less than it looks. Unit
tests written against the *stated behaviour* of each function, not against the
fixture, are what close that gap.

Cover at minimum:

**`normalize.ts`** — `normalizeCounterparty` strips bank noise and references;
`extractRefs` finds `INV-1234` / `PO-4001` in free text and returns them
uppercased and de-duplicated; `similarity` scores a truncated bank name against
a full vendor name above 0.8 and two unrelated vendors below 0.3; `daysBetween`
is order-independent.

**`rules.ts`** — build small in-memory `Side` objects and assert each pass in
isolation: an exact reference pair matches at 0.99; two identical-amount legs
sharing one reference produce **one** match and leave the second leg in the
residue; two legs summing to the ledger amount produce a single one-to-many
match; a cross-currency pair inside the FX band matches, one outside it does
not; unrelated rows are left alone.

**`guardrails.ts`** — every rule, both directions. An unbalanced entry blocks; a
balanced one does not. A date outside the period blocks. An agent posting above
$10,000 blocks while a human posting the same amount does not. Round-dollar and
stale-FX warn without blocking.

Aim for 25+ assertions. A test that only restates the implementation is worth
nothing — test the contract described in each function's comment.

---

## Worker H — Audit export
**Owns:** `src/app/api/export/**`, plus the export controls on `/audit` and `/journal`

The track asks for "gathering audit support" and the audit page currently
promises an export it does not have.

Add CSV download endpoints:

- `GET /api/export/audit?run=<id>` — the full decision log, agent and human
  alike, one row per event with the detail JSON flattened into readable columns.
- `GET /api/export/exceptions?run=<id>` — every exception with its category,
  severity, summary, suggested action, resolution and who resolved it.
- `GET /api/export/journal?run=<id>` — entries with their lines, one row per
  line, including blocked entries and the rule that blocked them.

Quote fields correctly (embedded commas, quotes and newlines are guaranteed in
the memo and message columns), set `Content-Disposition: attachment` with a
sensible filename, and add a small download button to each page.

An auditor should be able to open these three files and reconstruct the close
without access to the app.
