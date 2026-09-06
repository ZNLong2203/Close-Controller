import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PolicyFinding, PolicyInput } from "./guardrails";

/**
 * Every rule in both directions: the input that trips it and the neighbouring
 * input that must not. The duplicate-payment rule is the one check that reads
 * the ledger, so these tests run against a throwaway SQLite file rather than
 * the working database. The path has to be set before the module is loaded,
 * which is why guardrails is pulled in dynamically.
 */

const DB_FILE = join(tmpdir(), `close-controller-guardrails-${process.pid}.db`);
const RUN_ID = "run_test";

type Guardrails = typeof import("./guardrails");
let evaluatePolicy: Guardrails["evaluatePolicy"];
let isBlocked: Guardrails["isBlocked"];
let sql: Awaited<ReturnType<typeof import("../db").db>>;

before(async () => {
  process.env.CC_DB_PATH = DB_FILE;
  ({ evaluatePolicy, isBlocked } = await import("./guardrails"));
  sql = (await import("../db")).db();
  sql.prepare(`INSERT INTO run (id, started_at, period) VALUES (?, ?, ?)`)
    .run(RUN_ID, "2026-09-01T00:00:00.000Z", "2026-08");
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${DB_FILE}${suffix}`, { force: true });
});

const BALANCED = [
  { accountCode: "2000", debitCents: 100_000, creditCents: 0 },
  { accountCode: "1010", debitCents: 0, creditCents: 100_000 },
];

/** A posting that trips nothing, so any finding in a test came from what it changed. */
const input = (o: Partial<PolicyInput> = {}): PolicyInput => ({
  runId: RUN_ID,
  period: "2026-08",
  entryDate: "2026-08-15",
  lines: BALANCED,
  amountCents: 100_000,
  currency: "USD",
  actor: "agent",
  ...o,
});

const codes = (f: PolicyFinding[]) => f.map((x) => x.ruleCode);
const find = (f: PolicyFinding[], code: string) => f.filter((x) => x.ruleCode === code);

test("a clean posting trips nothing", () => {
  const findings = evaluatePolicy(input());
  assert.deepEqual(findings, []);
  assert.equal(isBlocked(findings), false);
});

// ── BALANCED_ENTRY ───────────────────────────────────────────────────────────

test("an unbalanced entry blocks", () => {
  const findings = evaluatePolicy(input({
    lines: [
      { accountCode: "2000", debitCents: 100_000, creditCents: 0 },
      { accountCode: "1010", debitCents: 0, creditCents: 99_000 },
    ],
  }));

  assert.deepEqual(codes(findings), ["BALANCED_ENTRY"]);
  assert.equal(findings[0].severity, "block");
  assert.ok(findings[0].message.includes("$10.00"), "the message states the size of the gap");
  assert.equal(isBlocked(findings), true);
});

test("a balanced entry does not", () => {
  assert.deepEqual(find(evaluatePolicy(input()), "BALANCED_ENTRY"), []);
});

test("a multi-line entry that balances in aggregate does not block", () => {
  const findings = evaluatePolicy(input({
    lines: [
      { accountCode: "2000", debitCents: 60_000, creditCents: 0 },
      { accountCode: "2001", debitCents: 40_000, creditCents: 0 },
      { accountCode: "1010", debitCents: 0, creditCents: 100_000 },
    ],
  }));
  assert.deepEqual(findings, []);
});

test("an entry with no lines at all blocks", () => {
  const findings = evaluatePolicy(input({ lines: [] }));
  assert.equal(find(findings, "BALANCED_ENTRY").length, 1, "empty is not the same complaint as unbalanced");
  assert.equal(isBlocked(findings), true);
});

// ── CLOSED_PERIOD ────────────────────────────────────────────────────────────

test("a date after the open period blocks", () => {
  const findings = evaluatePolicy(input({ entryDate: "2026-09-01" }));
  assert.deepEqual(codes(findings), ["CLOSED_PERIOD"]);
  assert.equal(findings[0].severity, "block");
  assert.equal(isBlocked(findings), true);
});

test("a date before the open period blocks", () => {
  const findings = evaluatePolicy(input({ entryDate: "2026-07-31" }));
  assert.equal(find(findings, "CLOSED_PERIOD").length, 1);
});

test("dates on either edge of the open period do not block", () => {
  assert.deepEqual(find(evaluatePolicy(input({ entryDate: "2026-08-01" })), "CLOSED_PERIOD"), []);
  assert.deepEqual(find(evaluatePolicy(input({ entryDate: "2026-08-31" })), "CLOSED_PERIOD"), []);
});

// ── UNAPPROVED_LIMIT ─────────────────────────────────────────────────────────

test("an agent posting above $10,000 blocks", () => {
  const findings = evaluatePolicy(input({ actor: "agent", amountCents: 1_234_567 }));
  assert.deepEqual(codes(findings), ["UNAPPROVED_LIMIT"]);
  assert.equal(findings[0].severity, "block");
  assert.equal(isBlocked(findings), true);
});

test("a human posting the same amount does not", () => {
  const findings = evaluatePolicy(input({ actor: "human", amountCents: 1_234_567 }));
  assert.deepEqual(findings, [], "the limit is on unattended posts, not on the amount");
  assert.equal(isBlocked(findings), false);
});

test("the limit applies to the magnitude, not the sign", () => {
  const findings = evaluatePolicy(input({ actor: "agent", amountCents: -1_234_567 }));
  assert.equal(find(findings, "UNAPPROVED_LIMIT").length, 1, "money out is still money");
});

test("an agent posting exactly at the limit does not block", () => {
  const findings = evaluatePolicy(input({ actor: "agent", amountCents: 1_000_000 }));
  assert.deepEqual(find(findings, "UNAPPROVED_LIMIT"), [], "the ceiling is 'above', not 'at'");
});

// ── DUPLICATE_PAYMENT ────────────────────────────────────────────────────────

function postJournalEntry(id: string, memo: string, status = "posted") {
  sql.prepare(
    `INSERT INTO journal_entry (id, run_id, entry_date, memo, status) VALUES (?, ?, ?, ?, ?)`
  ).run(id, RUN_ID, "2026-08-11", memo, status);
}

test("a reference already posted in this run blocks", () => {
  postJournalEntry("je_dup_1", "Settle INV-7001 · Northwind Logistics");
  const findings = evaluatePolicy(input({ reference: "INV-7001", vendor: "Northwind Logistics" }));

  assert.deepEqual(codes(findings), ["DUPLICATE_PAYMENT"]);
  assert.equal(findings[0].severity, "block");
  assert.ok(findings[0].message.includes("je_dup_1"), "the message names the prior entry");
  assert.equal(isBlocked(findings), true);
});

test("a reference not yet posted does not", () => {
  const findings = evaluatePolicy(input({ reference: "INV-7999", vendor: "Northwind Logistics" }));
  assert.deepEqual(findings, []);
});

test("a prior entry that was never posted does not block", () => {
  postJournalEntry("je_draft_1", "Settle INV-7002 · Contoso", "draft");
  const findings = evaluatePolicy(input({ reference: "INV-7002", vendor: "Contoso" }));
  assert.deepEqual(findings, [], "a draft has not paid anybody");
});

test("re-approving the same entry does not trip its own prior posting", () => {
  postJournalEntry("je_dup_2", "Settle INV-7003 · Acme Corp");
  const blocked = evaluatePolicy(input({ reference: "INV-7003", vendor: "Acme Corp" }));
  const reapproved = evaluatePolicy(
    input({ reference: "INV-7003", vendor: "Acme Corp", excludeJeId: "je_dup_2" })
  );

  assert.equal(find(blocked, "DUPLICATE_PAYMENT").length, 1);
  assert.deepEqual(reapproved, [], "the entry under review is not its own duplicate");
});

test("the duplicate check does not reach across runs", () => {
  sql.prepare(`INSERT INTO run (id, started_at, period) VALUES (?, ?, ?)`)
    .run("run_other", "2026-08-01T00:00:00.000Z", "2026-08");
  sql.prepare(
    `INSERT INTO journal_entry (id, run_id, entry_date, memo, status) VALUES (?, ?, ?, ?, ?)`
  ).run("je_other_run", "run_other", "2026-08-11", "Settle INV-7004 · Acme Corp", "posted");

  const findings = evaluatePolicy(input({ reference: "INV-7004", vendor: "Acme Corp" }));
  assert.deepEqual(findings, []);
});

// ── warnings: worth an eye, not worth stopping the close ─────────────────────

test("a round-thousand amount warns without blocking", () => {
  const findings = evaluatePolicy(input({ actor: "human", amountCents: 500_000 }));
  assert.deepEqual(codes(findings), ["ROUND_DOLLAR"]);
  assert.equal(findings[0].severity, "warn");
  assert.equal(isBlocked(findings), false);
});

test("an amount that is not a round thousand does not warn", () => {
  assert.deepEqual(find(evaluatePolicy(input({ amountCents: 512_345 })), "ROUND_DOLLAR"), []);
});

test("a small round amount is below the floor worth flagging", () => {
  assert.deepEqual(find(evaluatePolicy(input({ amountCents: 100_000 })), "ROUND_DOLLAR"), []);
});

test("a cross-currency entry with no rate warns without blocking", () => {
  const findings = evaluatePolicy(input({ isCrossCurrency: true, currency: "EUR" }));
  assert.deepEqual(codes(findings), ["STALE_FX"]);
  assert.equal(findings[0].severity, "warn");
  assert.equal(isBlocked(findings), false);
});

test("a cross-currency entry with a rate recorded does not warn", () => {
  const findings = evaluatePolicy(input({ isCrossCurrency: true, currency: "EUR", fxRate: 1.0842 }));
  assert.deepEqual(findings, []);
});

test("a same-currency entry is never asked for a rate", () => {
  assert.deepEqual(find(evaluatePolicy(input({ isCrossCurrency: false })), "STALE_FX"), []);
});

// ── composition ──────────────────────────────────────────────────────────────

test("findings accumulate and one block is enough to stop the posting", () => {
  const findings = evaluatePolicy(input({
    actor: "agent",
    amountCents: 1_500_000,
    entryDate: "2026-09-02",
    isCrossCurrency: true,
    currency: "EUR",
    lines: [{ accountCode: "2000", debitCents: 1_500_000, creditCents: 0 }],
  }));

  assert.deepEqual(
    codes(findings).sort(),
    ["BALANCED_ENTRY", "CLOSED_PERIOD", "ROUND_DOLLAR", "STALE_FX", "UNAPPROVED_LIMIT"]
  );
  assert.equal(isBlocked(findings), true);
});

test("a set of warnings alone never blocks", () => {
  const findings = evaluatePolicy(input({
    actor: "human", amountCents: 900_000, isCrossCurrency: true, currency: "GBP",
  }));
  assert.deepEqual(codes(findings).sort(), ["ROUND_DOLLAR", "STALE_FX"]);
  assert.equal(isBlocked(findings), false);
});
