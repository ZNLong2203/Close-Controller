-- Close Controller :: canonical schema. Money is ALWAYS integer cents.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS run (
  id            TEXT PRIMARY KEY,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  period        TEXT NOT NULL,            -- '2026-08'
  stats_json    TEXT,                     -- rollup metrics for the dashboard
  trace_id      TEXT
);

-- ---------- source documents ----------
CREATE TABLE IF NOT EXISTS bank_txn (
  id            TEXT PRIMARY KEY,
  posted_on     TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,         -- negative = money out
  currency      TEXT NOT NULL DEFAULT 'USD',
  description   TEXT NOT NULL,
  counterparty  TEXT,
  external_ref  TEXT,                     -- bank's own ref; duplicates are a real failure mode
  raw_json      TEXT
);

CREATE TABLE IF NOT EXISTS gl_entry (
  id            TEXT PRIMARY KEY,
  booked_on     TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  account_code  TEXT NOT NULL,
  memo          TEXT NOT NULL,
  vendor        TEXT,
  doc_type      TEXT,                     -- invoice | bill | journal | fee
  doc_ref       TEXT,
  raw_json      TEXT
);

CREATE TABLE IF NOT EXISTS purchase_order (
  id            TEXT PRIMARY KEY,
  po_no         TEXT NOT NULL UNIQUE,
  vendor        TEXT NOT NULL,
  issued_on     TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS goods_receipt (
  id            TEXT PRIMARY KEY,
  po_no         TEXT NOT NULL,
  received_on   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  qty           REAL
);

CREATE TABLE IF NOT EXISTS invoice (
  id            TEXT PRIMARY KEY,
  invoice_no    TEXT NOT NULL,
  vendor        TEXT NOT NULL,
  issued_on     TEXT NOT NULL,
  due_on        TEXT,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  po_no         TEXT,
  source_uri    TEXT                      -- citation target for the audit trail
);

-- ---------- matching ----------
-- A match is a claim: "these bank txns correspond to these GL entries".
CREATE TABLE IF NOT EXISTS match (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id),
  kind          TEXT NOT NULL,            -- bank_gl | three_way
  status        TEXT NOT NULL,            -- auto_posted | pending_review | approved | rejected | blocked
  confidence    REAL NOT NULL,
  method        TEXT NOT NULL,            -- rule_exact | rule_fuzzy | llm | human
  model         TEXT,                     -- which model decided, when method=llm
  reasoning     TEXT,
  evidence_json TEXT,                     -- [{label, source_uri, excerpt}] -> rendered in review UI
  cost_usd      REAL DEFAULT 0,
  latency_ms    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- one-to-many is a first-class case (partial payments, batched settlements)
CREATE TABLE IF NOT EXISTS match_line (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      TEXT NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL,            -- bank_txn | gl_entry | invoice | purchase_order | goods_receipt
  entity_id     TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_line_match ON match_line(match_id);
CREATE INDEX IF NOT EXISTS idx_match_line_entity ON match_line(entity_type, entity_id);

-- ---------- exceptions / human review ----------
CREATE TABLE IF NOT EXISTS exception (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id),
  match_id      TEXT REFERENCES match(id),
  bank_txn_id   TEXT REFERENCES bank_txn(id),
  gl_entry_id   TEXT REFERENCES gl_entry(id),
  evidence_json TEXT,                     -- rendered side-by-side in the review UI
  category      TEXT NOT NULL,            -- unmatched_bank | unmatched_gl | amount_variance | duplicate_suspect |
                                          -- timing_difference | fx_variance | low_confidence | policy_block | three_way_variance
  severity      TEXT NOT NULL,            -- low | medium | high
  summary       TEXT NOT NULL,
  suggested_action TEXT,
  status        TEXT NOT NULL,            -- open | resolved | dismissed
  resolved_by   TEXT,
  resolved_at   TEXT,
  resolution_note TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exception_run ON exception(run_id, status);

-- ---------- posting + guardrails ----------
CREATE TABLE IF NOT EXISTS journal_entry (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id),
  match_id      TEXT REFERENCES match(id),
  entry_date    TEXT NOT NULL,
  memo          TEXT NOT NULL,
  status        TEXT NOT NULL,            -- draft | posted | blocked
  posted_at     TEXT,
  posted_by     TEXT
);

CREATE TABLE IF NOT EXISTS journal_line (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  je_id         TEXT NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
  account_code  TEXT NOT NULL,
  debit_cents   INTEGER NOT NULL DEFAULT 0,
  credit_cents  INTEGER NOT NULL DEFAULT 0
);

-- Every guardrail decision is recorded, including the ones that passed silently.
CREATE TABLE IF NOT EXISTS policy_violation (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT NOT NULL REFERENCES run(id),
  subject_type  TEXT NOT NULL,            -- journal_entry | match
  subject_id    TEXT NOT NULL,
  rule_code     TEXT NOT NULL,            -- BALANCED_ENTRY | CLOSED_PERIOD | DUPLICATE_PAYMENT | ...
  severity      TEXT NOT NULL,            -- block | warn
  message       TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- ---------- audit ----------
CREATE TABLE IF NOT EXISTS audit_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT REFERENCES run(id),
  ts            TEXT NOT NULL,
  actor         TEXT NOT NULL,            -- 'agent:matcher' | 'agent:policy' | 'human:zkare'
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  detail_json   TEXT,
  trace_id      TEXT                      -- links to the Neatlogs trace
);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_event(run_id, ts);

-- ---------- evaluation ----------
-- Ground truth for the eval harness. Written by the seeder, never by the agent.
CREATE TABLE IF NOT EXISTS ground_truth (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture       TEXT NOT NULL,            -- which dataset this row belongs to
  bank_txn_id   TEXT,
  gl_entry_id   TEXT,
  relation      TEXT NOT NULL,            -- match | no_match_expected | exception_expected
  expected_exception TEXT,                -- category the system SHOULD raise
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_gt_fixture ON ground_truth(fixture);
