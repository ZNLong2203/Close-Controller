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

_None recorded yet._

Work still open and suited to parallel AO workers is specified in
[AO_TASKS.md](AO_TASKS.md). Each row here must name a real AO session, its
branch, and the merge commit it produced.

| # | AO session | Branch | Task | Merge commit |
|---|---|---|---|---|
| | | | | |
