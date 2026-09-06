import test from "node:test";
import assert from "node:assert/strict";
import { runRuleMatchers } from "./rules";
import type { Side } from "./normalize";
import type { BankTxn, GlEntry } from "../types";

/**
 * Each pass exercised in isolation on a hand-built Side, so a proposal can only
 * come from the pass under test. Amounts are integer cents and negative means
 * money out, as in the schema.
 */

const txn = (o: Partial<BankTxn> & { id: string }): BankTxn => ({
  posted_on: "2026-08-10", amount_cents: -100_000, currency: "USD",
  description: "ACH DEBIT NORTHWIND LOGISTICS", counterparty: "NORTHWIND LOGISTICS",
  external_ref: null, ...o,
});

const entry = (o: Partial<GlEntry> & { id: string }): GlEntry => ({
  booked_on: "2026-08-10", amount_cents: -100_000, currency: "USD", account_code: "2000",
  memo: "Northwind Logistics", vendor: "Northwind Logistics", doc_type: "bill",
  doc_ref: null, ...o,
});

/** No id may be both claimed and left in the residue, and none may vanish. */
function assertPartitions(side: Side, result: ReturnType<typeof runRuleMatchers>) {
  const claimedBank = result.proposals.flatMap((p) => p.bankTxnIds);
  const claimedGl = result.proposals.flatMap((p) => p.glEntryIds);
  assert.equal(new Set(claimedBank).size, claimedBank.length, "a bank line was claimed twice");
  assert.equal(new Set(claimedGl).size, claimedGl.length, "a ledger entry was claimed twice");
  assert.deepEqual(
    [...claimedBank, ...result.residue.bankIds].sort(),
    side.bank.map((b) => b.id).sort()
  );
  assert.deepEqual(
    [...claimedGl, ...result.residue.glIds].sort(),
    side.gl.map((g) => g.id).sort()
  );
}

function run(side: Side) {
  const result = runRuleMatchers(side);
  assertPartitions(side, result);
  return result;
}

// ── Pass 1 · shared reference ────────────────────────────────────────────────

test("an exact reference pair matches at 0.99", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", external_ref: "INV-9001", amount_cents: -412_355 })],
    gl: [entry({ id: "gl_1", doc_ref: "INV-9001", amount_cents: -412_355 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].confidence, 0.99);
  assert.equal(proposals[0].method, "rule_exact");
  assert.equal(proposals[0].kind, "bank_gl");
  assert.deepEqual(proposals[0].bankTxnIds, ["bt_1"]);
  assert.deepEqual(proposals[0].glEntryIds, ["gl_1"]);
  assert.deepEqual(residue, { bankIds: [], glIds: [] });
  assert.ok(proposals[0].evidence.length >= 3, "both sides plus the shared reference are cited");
});

test("a reference pair settled short of the ledger amount matches at 0.92", () => {
  // netted bank fee: inside the tolerance, but not identical to the cent
  const side: Side = {
    bank: [txn({ id: "bt_1", external_ref: "INV-9001", amount_cents: -409_855 })],
    gl: [entry({ id: "gl_1", doc_ref: "INV-9001", amount_cents: -412_355 })],
  };
  const { proposals } = run(side);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].confidence, 0.92);
  assert.ok(proposals[0].confidence < 0.99, "an inexact amount ranks below an exact one");
});

test("two identical-amount legs on one reference produce one match and one residual leg", () => {
  // a duplicate payment: each leg *equals* the bill, so only the earliest is
  // settled and the rest is deliberately left for duplicate review
  const side: Side = {
    bank: [
      txn({ id: "bt_late", posted_on: "2026-08-19", external_ref: "INV-9001", amount_cents: -412_355 }),
      txn({ id: "bt_first", posted_on: "2026-08-12", external_ref: "INV-9001", amount_cents: -412_355 }),
    ],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-12", doc_ref: "INV-9001", amount_cents: -412_355 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 1, "the duplicate must not be matched too");
  assert.deepEqual(proposals[0].bankTxnIds, ["bt_first"], "the earliest leg is the one that settles");
  assert.equal(proposals[0].confidence, 0.95);
  assert.deepEqual(residue.bankIds, ["bt_late"]);
  assert.deepEqual(residue.glIds, []);
});

test("two legs summing to the ledger amount produce a single one-to-many match", () => {
  const side: Side = {
    bank: [
      txn({ id: "bt_1", posted_on: "2026-08-12", external_ref: "INV-9001", amount_cents: -150_000 }),
      txn({ id: "bt_2", posted_on: "2026-08-19", external_ref: "INV-9001", amount_cents: -262_355 }),
    ],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-10", doc_ref: "INV-9001", amount_cents: -412_355 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 1, "a partial settlement is one match, not two half-truths");
  assert.deepEqual(proposals[0].bankTxnIds.sort(), ["bt_1", "bt_2"]);
  assert.deepEqual(proposals[0].glEntryIds, ["gl_1"]);
  assert.equal(proposals[0].confidence, 0.95);
  assert.deepEqual(residue, { bankIds: [], glIds: [] });
});

test("legs that do not sum to the ledger amount are left alone", () => {
  const side: Side = {
    bank: [
      txn({ id: "bt_1", posted_on: "2026-08-12", external_ref: "INV-9001", amount_cents: -150_000 }),
      txn({ id: "bt_2", posted_on: "2026-08-19", external_ref: "INV-9001", amount_cents: -100_000 }),
    ],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-10", doc_ref: "INV-9001", amount_cents: -412_355 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0);
  assert.deepEqual(residue.bankIds.sort(), ["bt_1", "bt_2"]);
  assert.deepEqual(residue.glIds, ["gl_1"]);
});

test("a reference claimed by two ledger entries is not resolved by guesswork", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", posted_on: "2026-08-25", external_ref: "INV-9001", amount_cents: -100_000 })],
    gl: [
      entry({ id: "gl_1", booked_on: "2026-08-01", doc_ref: "INV-9001", amount_cents: -100_000 }),
      entry({ id: "gl_2", booked_on: "2026-08-02", doc_ref: "INV-9001", amount_cents: -200_000 }),
    ],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0, "ambiguity goes to the reviewer, not to a coin flip");
  assert.deepEqual(residue.glIds.sort(), ["gl_1", "gl_2"]);
});

// ── FX band ──────────────────────────────────────────────────────────────────

test("a cross-currency reference pair inside the FX band matches", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", external_ref: "INV-9001", currency: "USD", amount_cents: -1_000_000 })],
    gl: [entry({ id: "gl_1", doc_ref: "INV-9001", currency: "EUR", amount_cents: -900_000 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].confidence, 0.88);
  assert.equal(proposals[0].method, "rule_exact");
  assert.deepEqual(residue, { bankIds: [], glIds: [] });
});

test("a cross-currency pair outside the FX band does not match", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", external_ref: "INV-9001", currency: "USD", amount_cents: -1_000_000 })],
    gl: [entry({ id: "gl_1", doc_ref: "INV-9001", currency: "EUR", amount_cents: -100_000 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0, "an implied rate of 10.0 is not a currency conversion");
  assert.deepEqual(residue.bankIds, ["bt_1"]);
  assert.deepEqual(residue.glIds, ["gl_1"]);
});

// ── Pass 2 · same day, identical amount, same party ──────────────────────────

test("same day, identical amount and the same party matches at 0.95 without a reference", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", posted_on: "2026-08-14", amount_cents: -288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  };
  const { proposals } = run(side);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].confidence, 0.95);
  assert.equal(proposals[0].method, "rule_exact");
});

test("the truncated bank counterparty still resolves to the ledger vendor", () => {
  const side: Side = {
    bank: [txn({
      id: "bt_1", posted_on: "2026-08-14", amount_cents: -288_400,
      counterparty: "ADVENTURE WO", description: "ACH DEBIT ADVENTURE WO",
    })],
    gl: [entry({
      id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400,
      vendor: "Adventure Works Travel", memo: "Adventure Works Travel",
    })],
  };
  const { proposals } = run(side);
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].bankTxnIds, ["bt_1"]);
});

test("same day and same amount but a different party is not matched", () => {
  const side: Side = {
    bank: [txn({
      id: "bt_1", posted_on: "2026-08-14", amount_cents: -288_400,
      counterparty: "CONTOSO PHARMACEUTICALS", description: "ACH DEBIT CONTOSO PHARMACEUTICALS",
    })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0, "an amount collision is not evidence of the same payment");
  assert.deepEqual(residue.bankIds, ["bt_1"]);
});

// ── Pass 3 · one-to-many without a shared reference ──────────────────────────

test("same-party legs summing to the ledger amount match one-to-many at 0.85", () => {
  const side: Side = {
    bank: [
      txn({ id: "bt_1", posted_on: "2026-08-12", amount_cents: -100_000 }),
      txn({ id: "bt_2", posted_on: "2026-08-18", amount_cents: -200_000 }),
    ],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-10", amount_cents: -300_000 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0].bankTxnIds.sort(), ["bt_1", "bt_2"]);
  assert.equal(proposals[0].method, "rule_fuzzy");
  assert.equal(proposals[0].confidence, 0.85);
  assert.deepEqual(residue, { bankIds: [], glIds: [] });
});

test("subset-sum does not reach outside its two-week window", () => {
  const side: Side = {
    bank: [
      txn({ id: "bt_1", posted_on: "2026-08-12", amount_cents: -100_000 }),
      txn({ id: "bt_2", posted_on: "2026-09-20", amount_cents: -200_000 }),
    ],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-10", amount_cents: -300_000 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0);
  assert.deepEqual(residue.glIds, ["gl_1"]);
});

// ── Pass 4 · fuzzy single pairs ──────────────────────────────────────────────

test("a timing difference matches fuzzily below the exact-reference score", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", posted_on: "2026-08-17", amount_cents: -288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  };
  const { proposals } = run(side);

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].method, "rule_fuzzy");
  assert.ok(proposals[0].confidence < 0.99, "a fuzzy pair never outranks a reference match");
  assert.ok(proposals[0].confidence >= 0.45, "below the review floor it would not be proposed at all");
});

test("fuzzy confidence falls as the two sides agree less well", () => {
  const near = runRuleMatchers({
    bank: [txn({ id: "bt_1", posted_on: "2026-08-15", amount_cents: -288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  });
  const far = runRuleMatchers({
    bank: [txn({ id: "bt_1", posted_on: "2026-08-19", amount_cents: -288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  });

  assert.equal(near.proposals.length, 1);
  assert.equal(far.proposals.length, 1);
  assert.ok(
    near.proposals[0].confidence > far.proposals[0].confidence,
    "a 1-day gap must score above a 5-day gap"
  );
});

test("a pair beyond the fuzzy date window is not matched", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", posted_on: "2026-08-25", amount_cents: -288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0);
  assert.deepEqual(residue.bankIds, ["bt_1"]);
  assert.deepEqual(residue.glIds, ["gl_1"]);
});

test("a receipt is never matched against a payment", () => {
  const side: Side = {
    bank: [txn({ id: "bt_1", posted_on: "2026-08-14", amount_cents: 288_400 })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-14", amount_cents: -288_400 })],
  };
  const { proposals } = run(side);
  assert.equal(proposals.length, 0, "opposite signs are opposite directions of money");
});

// ── residue ──────────────────────────────────────────────────────────────────

test("unrelated rows are left alone", () => {
  const side: Side = {
    bank: [txn({
      id: "bt_1", posted_on: "2026-08-03", amount_cents: -50_000,
      counterparty: "CONTOSO PHARMACEUTICALS", description: "ACH DEBIT CONTOSO PHARMACEUTICALS",
    })],
    gl: [entry({ id: "gl_1", booked_on: "2026-08-27", amount_cents: -777_777 })],
  };
  const { proposals, residue } = run(side);

  assert.equal(proposals.length, 0);
  assert.deepEqual(residue.bankIds, ["bt_1"]);
  assert.deepEqual(residue.glIds, ["gl_1"]);
});

test("an empty side yields nothing rather than throwing", () => {
  const { proposals, residue } = runRuleMatchers({ bank: [], gl: [] });
  assert.deepEqual(proposals, []);
  assert.deepEqual(residue, { bankIds: [], glIds: [] });
});
