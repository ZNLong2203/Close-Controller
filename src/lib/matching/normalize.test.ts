import test from "node:test";
import assert from "node:assert/strict";
import {
  bankRefs, daysBetween, extractRefs, glRefs, normalizeCounterparty, similarity,
} from "./normalize";
import type { BankTxn, GlEntry } from "../types";

/**
 * Contract tests for the canonical forms. Written against what the functions
 * promise in their comments, not against the aug2026 fixture — the fixture and
 * the matcher share an author, so agreement between them proves less than it
 * looks. Nothing here reads the database.
 */

test("normalizeCounterparty strips bank noise down to the party", () => {
  assert.equal(normalizeCounterparty("ACH DEBIT NORTHWIND LOGISTICS"), "northwind logistics");
  assert.equal(normalizeCounterparty("WIRE OUT INTL ACME CORP"), "acme corp");
  assert.equal(normalizeCounterparty("MONTHLY RECURRING PAYMENT CONTOSO"), "contoso");
});

test("normalizeCounterparty strips references and leg markers", () => {
  // a reference identifies the obligation, not the party, so it must not
  // survive into the party token
  assert.equal(normalizeCounterparty("ACH DEBIT NORTHWIND LOGISTICS INV-9001"), "northwind logistics");
  assert.equal(normalizeCounterparty("PAYMENT 1/2 NORTHWIND LOGISTICS"), "northwind logistics");
  assert.equal(normalizeCounterparty("WIRE REF PO 4001 ACME CORP"), "acme corp");
});

test("normalizeCounterparty drops digits and punctuation", () => {
  assert.equal(normalizeCounterparty("Blue Ridge Supply Co. #4471"), "blue ridge supply co");
});

test("normalizeCounterparty is total and idempotent", () => {
  assert.equal(normalizeCounterparty(""), "");
  assert.equal(normalizeCounterparty("ACH DEBIT WIRE FEE"), "", "a line of pure noise carries no party");
  const once = normalizeCounterparty("ACH DEBIT NORTHWIND LOGISTICS INV-9001");
  assert.equal(normalizeCounterparty(once), once);
});

test("the two sides of the same payment normalise to the same party token", () => {
  assert.equal(
    normalizeCounterparty("ACH DEBIT NORTHWIND LOGISTICS INV-9001"),
    normalizeCounterparty("Northwind Logistics INV-9001")
  );
});

test("extractRefs finds invoice and PO references in free text", () => {
  assert.deepEqual(extractRefs("Payment for INV-1234 against PO-4001"), ["INV-1234", "PO-4001"]);
});

test("extractRefs returns references uppercased", () => {
  assert.deepEqual(extractRefs("settles inv-1234"), ["INV-1234"]);
  assert.deepEqual(extractRefs("po-4001 released"), ["PO-4001"]);
});

test("extractRefs normalises the separator", () => {
  assert.deepEqual(extractRefs("INV 1234"), ["INV-1234"]);
  assert.deepEqual(extractRefs("INV1234"), ["INV-1234"]);
});

test("extractRefs de-duplicates repeated references", () => {
  assert.deepEqual(extractRefs("INV-1234 partial, balance of INV-1234"), ["INV-1234"]);
  assert.deepEqual(extractRefs("inv-1234 and INV 1234"), ["INV-1234"]);
});

test("extractRefs returns nothing when there is nothing to find", () => {
  assert.deepEqual(extractRefs(""), []);
  assert.deepEqual(extractRefs("ACH DEBIT NORTHWIND LOGISTICS"), []);
});

test("similarity scores a truncated bank name against the full vendor above 0.8", () => {
  // banks truncate the counterparty column to a fixed width
  assert.ok(similarity("ADVENTURE WO", "Adventure Works Travel") > 0.8);
  assert.ok(similarity("NORTHWIND LOGIST", "Northwind Logistics") > 0.8);
});

test("similarity scores two unrelated vendors below 0.3", () => {
  assert.ok(similarity("Northwind Logistics", "Contoso Pharmaceuticals") < 0.3);
  assert.ok(similarity("Acme Corp", "Blue Ridge Supply") < 0.3);
});

test("similarity is symmetric", () => {
  assert.equal(
    similarity("ADVENTURE WO", "Adventure Works Travel"),
    similarity("Adventure Works Travel", "ADVENTURE WO")
  );
});

test("similarity refuses to let a short fragment carry a containment match", () => {
  // "ab" is contained in the longer side but is not substantive, so the score
  // falls back to plain token overlap instead of a full 1.0
  assert.ok(similarity("ab", "ab cd ef") < 1);
  assert.equal(similarity("adventure", "adventure works travel"), 1, "a substantive token does carry it");
});

test("similarity is 0 when either side has no party token left", () => {
  assert.equal(similarity("", "Acme Corp"), 0);
  assert.equal(similarity("ACH DEBIT WIRE", "Acme Corp"), 0);
});

test("daysBetween is order-independent", () => {
  assert.equal(daysBetween("2026-08-01", "2026-08-06"), 5);
  assert.equal(daysBetween("2026-08-06", "2026-08-01"), 5);
  assert.equal(
    daysBetween("2026-08-06", "2026-08-01"),
    daysBetween("2026-08-01", "2026-08-06")
  );
});

test("daysBetween counts calendar distance across boundaries", () => {
  assert.equal(daysBetween("2026-08-14", "2026-08-14"), 0);
  assert.equal(daysBetween("2026-07-31", "2026-08-02"), 2);
  assert.equal(daysBetween("2026-08-01", "2026-09-01"), 31);
});

const txn = (o: Partial<BankTxn>): BankTxn => ({
  id: "bt_x", posted_on: "2026-08-10", amount_cents: -100_000, currency: "USD",
  description: "", counterparty: null, external_ref: null, ...o,
});
const entry = (o: Partial<GlEntry>): GlEntry => ({
  id: "gl_x", booked_on: "2026-08-10", amount_cents: -100_000, currency: "USD",
  account_code: "2000", memo: "", vendor: null, doc_type: null, doc_ref: null, ...o,
});

test("bankRefs unions the ref column and the description, de-duplicated", () => {
  assert.deepEqual(
    bankRefs(txn({ external_ref: "INV-9001", description: "ACH DEBIT NORTHWIND INV-9001" })),
    ["INV-9001"]
  );
  assert.deepEqual(
    bankRefs(txn({ external_ref: "INV-9001", description: "part payment of PO-4001" })).sort(),
    ["INV-9001", "PO-4001"]
  );
  assert.deepEqual(bankRefs(txn({ description: "ACH DEBIT NORTHWIND" })), []);
});

test("glRefs unions the doc_ref column and the memo, de-duplicated", () => {
  assert.deepEqual(glRefs(entry({ doc_ref: "INV-9001", memo: "Northwind Logistics INV-9001" })), ["INV-9001"]);
  assert.deepEqual(glRefs(entry({ memo: "accrual, no document" })), []);
});
