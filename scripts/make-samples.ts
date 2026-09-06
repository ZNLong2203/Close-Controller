/**
 * Generates the two CSVs in `data/samples/`.
 *
 * These exist so the import flow can be demonstrated without a real statement,
 * which means they have to contain the same spread of difficulty the fixture
 * does. An earlier version shared a reference and a vendor name on both sides
 * of every row, so the deterministic tier resolved all of it and the model tier
 * reported zero matches — an accurate result that made the architecture look
 * pointless.
 *
 * The mix below is deliberate:
 *   rules      shared reference · same-day amount · timing gap · partial payments
 *   model      vendor trading names · free-text memos · a transposed reference
 *   exceptions a duplicate payment · a posting over the approval limit
 *              · FX · a netted bank fee · residue on both sides
 *
 * Output format mimics a real export: DD/MM/YYYY on the bank side, DD-Mon-YYYY
 * on the ledger side, separate debit/credit columns, currency symbols, thousands
 * separators, parentheses for negatives, a running balance, and an opening
 * balance row with no date that the importer is expected to reject.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const bankDate = (d: number) => `${String(d).padStart(2, "0")}/03/2026`;
const glDate = (d: number) => `${String(d).padStart(2, "0")}-${MONTHS[2]}-2026`;
const usd = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface BankRow { day: number; desc: string; payee: string; ref: string; debit: number; credit: number }
interface GlRow { day: number; acct: string; acctName: string; memo: string; vendor: string; doc: string; amount: number }

const bank: BankRow[] = [];
const gl: GlRow[] = [];

const b = (day: number, desc: string, payee: string, ref: string, debit: number, credit = 0) =>
  bank.push({ day, desc, payee, ref, debit, credit });
const g = (day: number, acct: string, acctName: string, memo: string, vendor: string, doc: string, amount: number) =>
  gl.push({ day, acct, acctName, memo, vendor, doc, amount });

const ACCT: Record<string, [string, string]> = {
  "Northwind Logistics": ["6100", "Freight and delivery"],
  "Acme Cloud Services": ["6200", "Software and hosting"],
  "Contoso Legal LLP": ["6300", "Professional fees"],
  "Tailspin Marketing": ["6400", "Advertising"],
  "Adventure Works Travel": ["6500", "Travel and entertainment"],
  "Proseware Staffing": ["6000", "Contract labour"],
  "Litware Analytics": ["6200", "Software and hosting"],
  "Fabrikam Hardware": ["1500", "Plant and equipment"],
};
const acctOf = (v: string) => ACCT[v] ?? ["6900", "Other operating"];

// ── 1. Clean matches: reference on both sides. Rules, tier 1. ────────────────
const CLEAN: [string, number][] = [
  ["Northwind Logistics", 1240.0], ["Acme Cloud Services", 4875.6], ["Contoso Legal LLP", 9500.0],
  ["Tailspin Marketing", 2310.75], ["Proseware Staffing", 6840.0], ["Litware Analytics", 1985.4],
  ["Adventure Works Travel", 3120.5], ["Northwind Logistics", 875.25], ["Acme Cloud Services", 5240.0],
  ["Fabrikam Hardware", 4410.8], ["Tailspin Marketing", 1680.0], ["Contoso Legal LLP", 7250.0],
];
CLEAN.forEach(([v, amt], i) => {
  const ref = `INV-31${String(i + 1).padStart(2, "0")}`;
  const day = 2 + i * 2;
  const [a, an] = acctOf(v);
  b(day, `ACH DEBIT ${v.toUpperCase()} ${ref}`, v, ref, amt);
  g(day, a, an, `${v} ${ref}`, v, ref, -amt);
});

// ── 2. Timing difference: booked before it cleared, no reference. Tier 1. ────
const TIMING: [string, number, number, number][] = [
  ["Proseware Staffing", 3450.0, 6, 9],
  ["Litware Analytics", 2120.0, 11, 14],
  ["Adventure Works Travel", 1875.5, 17, 20],
];
TIMING.forEach(([v, amt, gd, bd]) => {
  const [a, an] = acctOf(v as string);
  g(gd as number, a, an, `${v} monthly services`, v as string, "", -(amt as number));
  b(bd as number, `WIRE OUT ${(v as string).slice(0, 14).toUpperCase()}`, v as string, "", amt as number);
});

// ── 3. Partial payment: one bill, two debits. Tier 1, one-to-many. ───────────
{
  const v = "Fabrikam Hardware", ref = "INV-3140", total = 8600.0;
  const [a, an] = acctOf(v);
  g(7, a, an, `${v} ${ref}`, v, ref, -total);
  b(9, `ACH DEBIT ${v.toUpperCase()} ${ref} PARTIAL 1/2`, v, ref, 5160.0);
  b(16, `ACH DEBIT ${v.toUpperCase()} ${ref} PARTIAL 2/2`, v, ref, 3440.0);
}

// ── 4. Duplicate payment. Second leg must stay unmatched. ────────────────────
{
  const v = "Tailspin Marketing", ref = "INV-3145", amt = 2750.0;
  const [a, an] = acctOf(v);
  g(12, a, an, `${v} ${ref}`, v, ref, -amt);
  b(13, `ACH DEBIT ${v.toUpperCase()} ${ref}`, v, ref, amt);
  b(19, `ACH DEBIT ${v.toUpperCase()} ${ref}`, v, ref, amt);
}

// ── 5. Above the unattended posting limit. Matches cleanly, still refused. ───
{
  const v = "Fabrikam Hardware", ref = "INV-3150", amt = 16400.0;
  const [a, an] = acctOf(v);
  g(21, a, an, `${v} ${ref} server refresh`, v, ref, -amt);
  b(21, `WIRE OUT ${v.toUpperCase()} ${ref}`, v, ref, amt);
}

// ── 6. FX: EUR bill settled in USD. ──────────────────────────────────────────
{
  const v = "Litware Analytics", ref = "INV-3155";
  const [a, an] = acctOf(v);
  gl.push({ day: 10, acct: a, acctName: an, memo: `${v} ${ref} (EUR)`, vendor: v, doc: ref, amount: -3200.0 });
  b(12, `INTL WIRE ${v.toUpperCase()} ${ref}`, v, ref, 3472.64);
}

// ── 7. Customer receipt with the processor fee netted off. ───────────────────
{
  const v = "Adventure Works Travel";
  g(15, "1100", "Accounts receivable", `Customer receipt ${v}`, v, "", 7400.0);
  b(15, `DEPOSIT ${v.toUpperCase()} NET OF FEE`, v, "", 0, 7363.5);
}

// ── 8. Vendor trades under an abbreviated name. Model tier. ──────────────────
const ALIASES: [string, string, number, number][] = [
  ["Acme Cloud Services", "ACME CLOUD SVCS", 1450.0, 4],
  ["Northwind Logistics", "NORTHWIND FREIGHT", 2280.5, 8],
  ["Adventure Works Travel", "ADV WORKS TVL", 990.75, 13],
  ["Proseware Staffing", "PROSEWARE PEOPLE OPS", 5120.0, 18],
];
ALIASES.forEach(([legal, trading, amt, day]) => {
  const [a, an] = acctOf(legal as string);
  g(day as number, a, an, `${legal} services`, legal as string, "", -(amt as number));
  b((day as number) + 1, `ACH DEBIT ${trading}`, trading as string, "", amt as number);
});

// ── 9. Ledger memo describes the spend, not the payee. Model tier. ───────────
const MEMOS: [string, string, number, number][] = [
  ["Q1 retainer, outside counsel", "Contoso Legal LLP", 4800.0, 5],
  ["Paid search and display spend", "Tailspin Marketing", 3260.0, 14],
  ["Employer of record, contractors", "Proseware Staffing", 7150.0, 22],
];
MEMOS.forEach(([memo, vendor, amt, day]) => {
  const [a, an] = acctOf(vendor as string);
  gl.push({ day: day as number, acct: a, acctName: an, memo: memo as string, vendor: "", doc: "", amount: -(amt as number) });
  b((day as number) + 1, `WIRE OUT ${(vendor as string).toUpperCase()}`, vendor as string, "", amt as number);
});

// ── 10. Reference mistyped by a human, payee field useless. Model tier. ──────
{
  const v = "Litware Analytics", good = "INV-3160", typo = "INV-31GO";
  const [a, an] = acctOf(v);
  g(23, a, an, `Supplier invoice ${good}`, v, good, -2640.0);
  b(25, `VENDOR PAYMENT REF ${typo}`, "", "", 2640.0);
}

// ── 11. Residue on both sides. ───────────────────────────────────────────────
b(3, "MONTHLY ACCOUNT MAINTENANCE FEE", "First Meridian Bank", "", 45.0);
b(17, "WIRE TRANSFER FEE", "First Meridian Bank", "", 32.5);
b(27, "CARD SCHEME INTERCHANGE", "First Meridian Bank", "", 118.25);
g(26, "6100", "Freight and delivery", "Accrual, March freight not yet invoiced", "Northwind Logistics", "", -1980.0);
g(28, "6400", "Advertising", "Accrual, agency retainer March", "Tailspin Marketing", "", -2400.0);

// ── write ────────────────────────────────────────────────────────────────────
bank.sort((x, y) => x.day - y.day);
gl.sort((x, y) => x.day - y.day);

const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

let balance = 84250.0;
const bankLines = [
  "Posted Date,Description,Payee,Reference,Debit,Credit,Balance",
  // No date: the importer must reject this rather than guess one.
  `,OPENING BALANCE BROUGHT FORWARD,,,,,${q(usd(balance))}`,
];
for (const r of bank) {
  balance += r.credit - r.debit;
  bankLines.push([
    bankDate(r.day), q(r.desc), q(r.payee), r.ref,
    r.debit ? q(`$${usd(r.debit)}`) : "",
    r.credit ? q(`$${usd(r.credit)}`) : "",
    q(usd(balance)),
  ].join(","));
}
bankLines.push(`,CLOSING BALANCE,,,,,${q(usd(balance))}`);

const glLines = ["Date,Account Code,Account Name,Memo,Vendor,Document No,Amount,Currency"];
for (const r of gl) {
  const amt = r.amount < 0 ? `(${usd(-r.amount)})` : usd(r.amount);
  const ccy = r.memo.includes("(EUR)") ? "EUR" : "USD";
  glLines.push([glDate(r.day), r.acct, q(r.acctName), q(r.memo), q(r.vendor), r.doc, q(amt), ccy].join(","));
}

const dir = join(process.cwd(), "data", "samples");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "bank_statement_sample.csv"), bankLines.join("\r\n") + "\r\n");
writeFileSync(join(dir, "general_ledger_sample.csv"), glLines.join("\r\n") + "\r\n");

console.log(`wrote data/samples/ — ${bank.length} bank rows (+2 balance rows), ${gl.length} ledger rows`);
