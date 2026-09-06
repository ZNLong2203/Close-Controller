# AO Session Log

> **Status: incomplete.** Rows below record what actually happened. Sessions run
> in Agent Orchestrator are listed separately once they exist — this file is not
> a narrative, it is a record, and it should be checkable against
> `git log --graph --all` and the AO dashboard.

## Build so far — single-branch, no AO sessions

All work to this point was done by Claude Code in the editor, committed directly
to `main`. There were no worker branches and no merges; `git branch -a` shows
one branch, which is the honest picture.

| Commit | Work |
|---|---|
| `aad953d` | Schema, db layer, ground-truth fixture generator |
| `1349dbd` | Four-tier pipeline spine and interface contracts |
| `0246b32` | Gemini swap; public/private docs split |
| `e405bf5` `63a7856` | Flow reference, results table |
| `882235f` | Rule tier, Gemini tier, exceptions, policy engine, review loop |
| `249eacc` | Eval harness with baseline comparison |
| `9526a7e` | Review UI |
| `0007c54` `a75de17` | AO log, build-cache hygiene |
| `7aec935` | Gemini `thinkingLevel` fix, measured results |
| `b60ea16` `de0cb9d` | Secret purge, pre-commit and commit-msg guards |
| `1887374` | Journal screen, tier split on the dashboard |

## AO sessions

Three workers, spawned from the specifications in [AO_TASKS.md](AO_TASKS.md) and
run concurrently in Agent Orchestrator on isolated worktrees. Each row is
checkable against `git log --graph --all`.

| # | AO session | Branch | Task | Merge commit |
|---|---|---|---|---|
| 1 | `syndicatebymaximor-1` | `ao/syndicatebymaximor-1/csv-import` | CSV ingestion — upload, column mapping, date/amount parsing, preview, commit | `d270ffa` |
| 3 | `syndicatebymaximor-3` | `ao/syndicatebymaximor-3/tests` | node:test suite — 63 tests across normalize, rules and guardrails | `7901947` |
| 4 | `syndicatebymaximor-4` | `ao/syndicatebymaximor-4/audit-export` | CSV exports — decision log, exceptions, journal, with download controls | `798cdf2` |

Every branch was cut from `de0cb9d` and merged with `--no-ff`, so the session
boundaries survive in the graph rather than being flattened away.

**What parallelism cost and returned.** The three sessions owned disjoint
directories, which is why they could run at once, but two collisions still had
to be resolved by hand: sessions 4 and 1 both added a `probe:*` script to
`package.json`, and session 4 built its own journal page without knowing `main`
had gained one. Interface contracts prevent conflicts inside a module; they do
not prevent two agents reaching for the same shared file.

Session 1 also caught something the single-branch work had missed — the run
period was hard-coded to the fixture's `2026-08`, which would have failed every
posting on `CLOSED_PERIOD` the moment a judge imported their own statement. It
replaced it with `detectPeriod()`.
