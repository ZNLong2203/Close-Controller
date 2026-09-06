# Close Controller

**Track 2 — Autonomous Office of the CFO · Syndicate by Maximor**

An autonomous bank-reconciliation and three-way-match controller. It closes the
easy 80% of a month-end without a human, and hands the remaining 20% to a
reviewer as a typed queue where every item already carries its evidence.

> A controller reconciling August by hand opens two spreadsheets and works down
> 160 bank lines against 147 ledger entries. Most of it is mechanical. The value
> is in the handful of rows that are genuinely wrong — a duplicate payment, an
> invoice billed above its goods receipt — and those are the rows fatigue hides.

## What it does

1. Ingests bank transactions, general-ledger entries, invoices, purchase orders
   and goods receipts.
2. Matches them in four tiers (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)),
   spending LLM tokens only on what deterministic rules could not place.
3. Auto-posts high-confidence matches as balanced journal entries; routes the
   rest to a human review queue.
4. Runs every posting through a policy engine that will refuse to book a
   duplicate payment, an unbalanced entry, or a posting into a closed period.
5. Writes balanced journal entries, keeping refused ones visible rather than
   discarding them.
6. Records every decision — agent and human — in an exportable audit trail.

## Measured against the LLM-only baseline

| | Baseline | Close Controller |
|---|---|---|
| Match F1 | 91.8% | **99.1%** |
| False auto-posts | 1 | **0** |
| Cost per 1,000 txns | $0.59 | **$0.08** |
| Wall time | 57.3 s | **11.8 s** |

Full table, including per-category exception detection: [docs/RESULTS.md](docs/RESULTS.md).

## Quickstart

```bash
npm install
cp .env.example .env      # add GEMINI_API_KEY
npm run seed              # build the aug2026 fixture
npm run dev               # http://localhost:3000
npm run eval              # score the matcher against ground truth
```

## Why it is built this way

The pipeline is a fixed sequence, not a free-roaming agent loop. In finance a
reviewer has to be able to explain why the system acted, and to an auditor
"the model decided" is not an answer. A deterministic spine with a scoped LLM
tier is what makes the model's contribution reviewable — and it is also why the
per-transaction cost stays low.

## Screens

| | |
|---|---|
| **Run** | Trigger a close; auto-match rate, cost, and which tier resolved what |
| **Review queue** | Typed exceptions with bank and ledger side by side, and the fields the system cited |
| **Journal** | Every entry produced, expandable to its lines; blocked entries kept with their reason |
| **Audit trail** | Agent and human decisions in one log, filterable, exportable |

## Docs

| | |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Components, tiers, data model, design rationale |
| [Flow](docs/FLOW.md) | Run lifecycle, exception lifecycle, review loop |
| [Results](docs/RESULTS.md) | Eval harness output, baseline comparison |
| [AO tasks](docs/AO_TASKS.md) | How the build was parallelised across AO workers |
| [AO log](docs/AO_LOG.md) | Session-by-session build record |

## Credits

Gemini API (`@google/genai`) for the LLM tier · Neatlogs for agent tracing ·
built with Agent Orchestrator.
