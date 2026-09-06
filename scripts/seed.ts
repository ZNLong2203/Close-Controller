/**
 * Deterministic fixture generator.
 *
 * The point of this file is the *edge cases*, not the volume. A reconciliation demo
 * that only contains exact matches proves nothing. Every scenario below is a real
 * failure mode we have to either match correctly or escalate as a typed exception,
 * and every row is written to `ground_truth` so `npm run eval` can score us.
 */
import { db, resetDb, nowIso } from "../src/lib/db";

// ---- deterministic RNG so eval numbers are reproducible across runs ----
let _s = 0x2f6e2b1;
const rnd = () => ((_s = (_s * 1664525 + 1013904223) >>> 0) / 0x100000000);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const cents = (dollars: number) => Math.round(dollars * 100);

const VENDORS = [
  "Northwind Logistics", "Acme Cloud Services", "Contoso Legal LLP", "Fabrikam Hardware",
  "Tailspin Marketing", "Litware Analytics", "Adventure Works Travel", "Proseware Staffing",
];
const ACCOUNTS: Record<string, string> = {
  "Northwind Logistics": "6100", "Acme Cloud Services": "6200", "Contoso Legal LLP": "6300",
  "Fabrikam Hardware": "1500", "Tailspin Marketing": "6400", "Litware Analytics": "6200",
  "Adventure Works Travel": "6500", "Proseware Staffing": "6000",
};

const PERIOD = "2026-08";
const day = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;

type Row = Record<string, unknown>;
const bank: Row[] = [];
const gl: Row[] = [];
const invoices: Row[] = [];
const pos: Row[] = [];
const receipts: Row[] = [];
const truth: Row[] = [];

let n = 0;
const bid = () => `btx_${String(++n).padStart(4, "0")}`;
let m = 0;
const gid = () => `gle_${String(++m).padStart(4, "0")}`;

function addBank(o: Partial<Row> & { posted_on: string; amount_cents: number; description: string }) {
  const row = {
    id: bid(), currency: "USD", counterparty: null, external_ref: null, raw_json: null, ...o,
  };
  bank.push(row);
  return row.id as string;
}
function addGl(o: Partial<Row> & { booked_on: string; amount_cents: number; memo: string; account_code: string }) {
  const row = {
    id: gid(), currency: "USD", vendor: null, doc_type: "bill", doc_ref: null, raw_json: null, ...o,
  };
  gl.push(row);
  return row.id as string;
}
const gt = (o: Row) => truth.push({ fixture: "aug2026", bank_txn_id: null, gl_entry_id: null, expected_exception: null, note: null, ...o });

// ── 1. Clean exact matches: same day, same amount, ref in both sides. ──────────
// These must be caught by rules alone — an LLM call here is wasted money.
for (let i = 0; i < 90; i++) {
  const v = pick(VENDORS);
  const d = day(1 + Math.floor(rnd() * 27));
  const amt = -cents(120 + Math.floor(rnd() * 8000) / 10);
  const inv = `INV-${9000 + i}`;
  const b = addBank({ posted_on: d, amount_cents: amt, description: `ACH DEBIT ${v.toUpperCase()} ${inv}`, counterparty: v, external_ref: inv });
  const g = addGl({ booked_on: d, amount_cents: amt, memo: `${v} ${inv}`, account_code: ACCOUNTS[v], vendor: v, doc_ref: inv });
  invoices.push({ id: `inv_${i}`, invoice_no: inv, vendor: v, issued_on: d, due_on: d, amount_cents: -amt, currency: "USD", po_no: null, source_uri: `/docs/${inv}.pdf` });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: "exact" });
}

// ── 2. Timing differences: booked in GL before the bank cleared it. ───────────
// Classic month-end noise. Same amount, 1-4 days apart, no shared ref.
for (let i = 0; i < 22; i++) {
  const v = pick(VENDORS);
  const gd = 3 + Math.floor(rnd() * 20);
  const bd = gd + 1 + Math.floor(rnd() * 4);
  const amt = -cents(200 + Math.floor(rnd() * 5000) / 10);
  const g = addGl({ booked_on: day(gd), amount_cents: amt, memo: `${v} monthly services`, account_code: ACCOUNTS[v], vendor: v });
  const b = addBank({ posted_on: day(Math.min(bd, 31)), amount_cents: amt, description: `WIRE OUT ${v.slice(0, 12).toUpperCase()}`, counterparty: v });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: "timing difference" });
}

// ── 3. Partial payments: one GL bill settled by two bank debits. ─────────────
// Tests one-to-many. Naive matchers report both legs as unmatched.
for (let i = 0; i < 8; i++) {
  const v = pick(VENDORS);
  const total = cents(3000 + Math.floor(rnd() * 40000) / 10);
  const first = Math.round(total * 0.6);
  const inv = `INV-77${i}`;
  const g = addGl({ booked_on: day(5 + i), amount_cents: -total, memo: `${v} ${inv}`, account_code: ACCOUNTS[v], vendor: v, doc_ref: inv });
  const b1 = addBank({ posted_on: day(7 + i), amount_cents: -first, description: `ACH DEBIT ${v.toUpperCase()} ${inv} PARTIAL 1/2`, counterparty: v, external_ref: inv });
  const b2 = addBank({ posted_on: day(15 + i), amount_cents: -(total - first), description: `ACH DEBIT ${v.toUpperCase()} ${inv} PARTIAL 2/2`, counterparty: v, external_ref: inv });
  gt({ bank_txn_id: b1, gl_entry_id: g, relation: "match", note: "partial payment 1/2" });
  gt({ bank_txn_id: b2, gl_entry_id: g, relation: "match", note: "partial payment 2/2" });
}

// ── 4. Bank fee netted into the settlement. ──────────────────────────────────
// Bank deposits (invoice - fee); the GL only knows about the invoice.
// Correct behaviour is to match AND raise an amount_variance for the fee stub.
for (let i = 0; i < 6; i++) {
  const v = pick(VENDORS);
  const gross = cents(5000 + Math.floor(rnd() * 30000) / 10);
  const fee = cents(15 + Math.floor(rnd() * 600) / 10);
  const g = addGl({ booked_on: day(9 + i), amount_cents: gross, memo: `Customer receipt ${v}`, account_code: "1100", vendor: v, doc_type: "invoice" });
  const b = addBank({ posted_on: day(9 + i), amount_cents: gross - fee, description: `DEPOSIT ${v.toUpperCase()} NET OF FEE`, counterparty: v });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", expected_exception: "amount_variance", note: `bank fee ${fee}c netted` });
}

// ── 5. Duplicate payment. The single most expensive error in AP. ─────────────
// Same invoice paid twice; must be flagged, never silently matched.
for (let i = 0; i < 4; i++) {
  const v = pick(VENDORS);
  const amt = -cents(1200 + i * 337.5);
  const inv = `INV-DUP${i}`;
  const g = addGl({ booked_on: day(11 + i), amount_cents: amt, memo: `${v} ${inv}`, account_code: ACCOUNTS[v], vendor: v, doc_ref: inv });
  const b1 = addBank({ posted_on: day(12 + i), amount_cents: amt, description: `ACH DEBIT ${v.toUpperCase()} ${inv}`, counterparty: v, external_ref: inv });
  const b2 = addBank({ posted_on: day(13 + i), amount_cents: amt, description: `ACH DEBIT ${v.toUpperCase()} ${inv}`, counterparty: v, external_ref: inv });
  gt({ bank_txn_id: b1, gl_entry_id: g, relation: "match", note: "legitimate leg of duplicate pair" });
  gt({ bank_txn_id: b2, relation: "exception_expected", expected_exception: "duplicate_suspect", note: "second payment of same invoice" });
}

// ── 6. FX variance: invoice in EUR, settled in USD at a different rate. ──────
for (let i = 0; i < 5; i++) {
  const v = pick(VENDORS);
  const eur = cents(2000 + i * 613.25);
  const usd = Math.round(eur * (1.08 + (rnd() - 0.5) * 0.03));
  const inv = `INV-FX${i}`;
  const g = addGl({ booked_on: day(6 + i * 3), amount_cents: -eur, currency: "EUR", memo: `${v} ${inv} (EUR)`, account_code: ACCOUNTS[v], vendor: v, doc_ref: inv });
  const b = addBank({ posted_on: day(8 + i * 3), amount_cents: -usd, currency: "USD", description: `INTL WIRE ${v.toUpperCase()} ${inv}`, counterparty: v, external_ref: inv });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", expected_exception: "fx_variance", note: "EUR bill settled in USD" });
}

// ── 7. Reversal pair: a payment and its same-month clawback. ─────────────────
for (let i = 0; i < 3; i++) {
  const v = pick(VENDORS);
  const amt = -cents(900 + i * 250);
  const g1 = addGl({ booked_on: day(4 + i), amount_cents: amt, memo: `${v} services`, account_code: ACCOUNTS[v], vendor: v });
  const b1 = addBank({ posted_on: day(4 + i), amount_cents: amt, description: `ACH DEBIT ${v.toUpperCase()}`, counterparty: v });
  const g2 = addGl({ booked_on: day(18 + i), amount_cents: -amt, memo: `REVERSAL ${v} services`, account_code: ACCOUNTS[v], vendor: v, doc_type: "journal" });
  const b2 = addBank({ posted_on: day(18 + i), amount_cents: -amt, description: `ACH RETURN ${v.toUpperCase()}`, counterparty: v });
  gt({ bank_txn_id: b1, gl_entry_id: g1, relation: "match", note: "original" });
  gt({ bank_txn_id: b2, gl_entry_id: g2, relation: "match", note: "reversal" });
}

// ── 8. Genuinely unmatched: bank-only (unrecorded bank charges). ─────────────
for (let i = 0; i < 7; i++) {
  const b = addBank({ posted_on: day(2 + i * 4), amount_cents: -cents(12 + i * 3.5), description: `MONTHLY ACCOUNT MAINTENANCE FEE`, counterparty: "First Meridian Bank" });
  gt({ bank_txn_id: b, relation: "exception_expected", expected_exception: "unmatched_bank", note: "unrecorded bank charge" });
}

// ── 9. Genuinely unmatched: GL-only (accrual with no cash movement yet). ─────
for (let i = 0; i < 6; i++) {
  const v = pick(VENDORS);
  const g = addGl({ booked_on: day(24 + i), amount_cents: -cents(800 + i * 410), memo: `Accrual ${v} August`, account_code: ACCOUNTS[v], vendor: v, doc_type: "journal" });
  gt({ gl_entry_id: g, relation: "exception_expected", expected_exception: "unmatched_gl", note: "accrual, settles next period" });
}

// ── 10. Three-way match set: PO / goods receipt / invoice, incl. over-billing. ─
for (let i = 0; i < 10; i++) {
  const v = pick(VENDORS);
  const poNo = `PO-40${i}`;
  const poAmt = cents(4000 + i * 725);
  // every 4th vendor over-bills against the receipt -> must raise three_way_variance
  const overBill = i % 4 === 3;
  const recvAmt = poAmt;
  const invAmt = overBill ? Math.round(poAmt * 1.12) : poAmt;
  pos.push({ id: `po_${i}`, po_no: poNo, vendor: v, issued_on: day(2 + i), amount_cents: poAmt, currency: "USD" });
  receipts.push({ id: `gr_${i}`, po_no: poNo, received_on: day(6 + i), amount_cents: recvAmt, qty: 1 });
  invoices.push({ id: `inv_po_${i}`, invoice_no: `INV-PO${i}`, vendor: v, issued_on: day(8 + i), due_on: day(28), amount_cents: invAmt, currency: "USD", po_no: poNo, source_uri: `/docs/INV-PO${i}.pdf` });
  if (overBill) gt({ relation: "exception_expected", expected_exception: "three_way_variance", note: `${poNo} invoice exceeds receipt by 12%` });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cases below are deliberately unreachable by deterministic rules. They are why
// the LLM tier exists: each one needs semantic judgement that no amount of
// string normalisation will produce. If the rule tier ever starts matching
// these, the rules have become reckless and the eval will show it as precision
// loss rather than as a win.
// ═══════════════════════════════════════════════════════════════════════════

// ── 11. Vendor trades under an abbreviated name on the bank statement. ───────
// Token overlap sits below the fuzzy floor; a human reads "SVCS" as "Services"
// instantly and so does a model. Rules cannot without a hand-built alias table.
const ALIASES: [string, string][] = [
  ["Acme Cloud Services", "ACME CLOUD SVCS"],
  ["Northwind Logistics", "NORTHWIND FREIGHT"],
  ["Adventure Works Travel", "ADV WORKS TVL"],
  ["Tailspin Marketing", "TAILSPIN MKTG GRP"],
  ["Litware Analytics", "LITWARE DATA SCIENCE"],
  ["Proseware Staffing", "PROSEWARE PEOPLE OPS"],
  ["Contoso Legal LLP", "CONTOSO ATTORNEYS"],
  ["Fabrikam Hardware", "FABRIKAM INDUSTRIAL"],
];
for (let i = 0; i < ALIASES.length; i++) {
  const [legal, trading] = ALIASES[i];
  const d0 = 3 + i * 3;
  const amt = -cents(1500 + i * 427.5);
  const g = addGl({ booked_on: day(d0), amount_cents: amt, memo: `${legal} services`, account_code: ACCOUNTS[legal], vendor: legal });
  const b = addBank({ posted_on: day(d0 + (i % 3)), amount_cents: amt, description: `ACH DEBIT ${trading}`, counterparty: trading });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: `vendor alias: ${trading} = ${legal}` });
}

// ── 12. Ledger memo is free text with no vendor field at all. ────────────────
// The accountant wrote what the spend was for, not who it was to. Matching
// requires inferring the party from the nature of the expense.
const MEMOS: [string, string][] = [
  ["Q3 retainer - outside counsel", "Contoso Legal LLP"],
  ["Employer of record - contractors", "Proseware Staffing"],
  ["Conference booth and airfare", "Adventure Works Travel"],
  ["Compute and object storage", "Acme Cloud Services"],
  ["Paid search and display spend", "Tailspin Marketing"],
  ["Freight forwarding - inbound", "Northwind Logistics"],
];
for (let i = 0; i < MEMOS.length; i++) {
  const [memo, vendor] = MEMOS[i];
  const d0 = 5 + i * 4;
  const amt = -cents(2200 + i * 318.75);
  const g = addGl({ booked_on: day(d0), amount_cents: amt, memo, account_code: ACCOUNTS[vendor], vendor: null });
  const b = addBank({ posted_on: day(d0 + 1), amount_cents: amt, description: `WIRE OUT ${vendor.toUpperCase()}`, counterparty: vendor });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: `memo inference: "${memo}" -> ${vendor}` });
}

// ── 13. Payment-processor payout: one deposit, several customer invoices. ────
// The bank sees a single settlement from Stripe. The ledger sees three separate
// receivables from three unrelated customers. No shared party, no shared ref.
for (let i = 0; i < 3; i++) {
  const legs: string[] = [];
  let total = 0;
  for (let j = 0; j < 3; j++) {
    const v = VENDORS[(i * 3 + j) % VENDORS.length];
    const amt = cents(700 + (i * 3 + j) * 233.5);
    total += amt;
    legs.push(addGl({ booked_on: day(10 + i * 5), amount_cents: amt, memo: `Customer receipt ${v}`, account_code: "1100", vendor: v, doc_type: "invoice" }));
  }
  const b = addBank({ posted_on: day(12 + i * 5), amount_cents: total, description: `STRIPE PAYOUT BATCH 88${200 + i}`, counterparty: "Stripe Payments" });
  for (const g of legs) gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: `PSP payout: 1 deposit covers 3 receivables` });
}

// ── 14. Reference transposed by a human, party field useless. ────────────────
// "INV-9O01" with a letter O. The only signal is the near-miss reference, and
// exact-string bucketing cannot see it.
for (let i = 0; i < 4; i++) {
  const v = pick(VENDORS);
  const good = `INV-52${i}1`;
  const typo = good.replace("0", "O").replace("5", "S");
  const amt = -cents(3300 + i * 512.25);
  const g = addGl({ booked_on: day(14 + i * 2), amount_cents: amt, memo: `Supplier invoice ${good}`, account_code: ACCOUNTS[v], vendor: v, doc_ref: good });
  const b = addBank({ posted_on: day(16 + i * 2), amount_cents: amt, description: `VENDOR PAYMENT REF ${typo}`, counterparty: null });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: `transposed reference ${typo} -> ${good}` });
}


// ── 15. A payment above the unattended posting limit. ────────────────────────
// Matches perfectly and would auto-post on confidence alone. Policy stops it:
// above $10,000 a person signs, whatever the model thinks.
{
  const v = "Fabrikam Hardware";
  const inv = "INV-CAPEX01";
  const amt = -cents(18_450);
  const b = addBank({ posted_on: day(19), amount_cents: amt, description: `WIRE OUT ${v.toUpperCase()} ${inv}`, counterparty: v, external_ref: inv });
  const g = addGl({ booked_on: day(19), amount_cents: amt, memo: `${v} ${inv} server refresh`, account_code: "1500", vendor: v, doc_ref: inv });
  gt({ bank_txn_id: b, gl_entry_id: g, relation: "match", note: "above unattended posting limit" });
}

// ── write ─────────────────────────────────────────────────────────────────────
resetDb();
const d = db();

const insBank = d.prepare(`INSERT INTO bank_txn (id,posted_on,amount_cents,currency,description,counterparty,external_ref,raw_json)
  VALUES (@id,@posted_on,@amount_cents,@currency,@description,@counterparty,@external_ref,@raw_json)`);
const insGl = d.prepare(`INSERT INTO gl_entry (id,booked_on,amount_cents,currency,account_code,memo,vendor,doc_type,doc_ref,raw_json)
  VALUES (@id,@booked_on,@amount_cents,@currency,@account_code,@memo,@vendor,@doc_type,@doc_ref,@raw_json)`);
const insInv = d.prepare(`INSERT INTO invoice (id,invoice_no,vendor,issued_on,due_on,amount_cents,currency,po_no,source_uri)
  VALUES (@id,@invoice_no,@vendor,@issued_on,@due_on,@amount_cents,@currency,@po_no,@source_uri)`);
const insPo = d.prepare(`INSERT INTO purchase_order (id,po_no,vendor,issued_on,amount_cents,currency)
  VALUES (@id,@po_no,@vendor,@issued_on,@amount_cents,@currency)`);
const insGr = d.prepare(`INSERT INTO goods_receipt (id,po_no,received_on,amount_cents,qty)
  VALUES (@id,@po_no,@received_on,@amount_cents,@qty)`);
const insGt = d.prepare(`INSERT INTO ground_truth (fixture,bank_txn_id,gl_entry_id,relation,expected_exception,note)
  VALUES (@fixture,@bank_txn_id,@gl_entry_id,@relation,@expected_exception,@note)`);

d.transaction(() => {
  for (const r of bank) insBank.run(r);
  for (const r of gl) insGl.run(r);
  for (const r of invoices) insInv.run(r);
  for (const r of pos) insPo.run(r);
  for (const r of receipts) insGr.run(r);
  for (const r of truth) insGt.run(r);
})();

const expectedExceptions = truth.filter((t) => t.expected_exception).length;
console.log(`seeded fixture "aug2026" (period ${PERIOD}) @ ${nowIso()}`);
console.table({
  bank_txns: bank.length,
  gl_entries: gl.length,
  invoices: invoices.length,
  purchase_orders: pos.length,
  goods_receipts: receipts.length,
  ground_truth_rows: truth.length,
  expected_exceptions: expectedExceptions,
});
