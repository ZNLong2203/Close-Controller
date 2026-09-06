/**
 * Probes the CSV importer's two dangerous parsers — money and dates — against
 * the shapes real exports actually contain, plus an end-to-end pass over the
 * bundled samples.
 *
 * `parseFloat("1,234.56")` is 1. That single fact is why this file exists: an
 * importer that is out by three orders of magnitude on one row is worse than
 * one that refused the file, and the only way to keep that claim honest is to
 * assert it.
 *
 *   npm run probe:import
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../src/lib/import/csv";
import { parseMoneyCents, applyMarker } from "../src/lib/import/money";
import { parseDateIso, detectDateOrder } from "../src/lib/import/dates";
import { guessMapping } from "../src/lib/import/mapping";
import { transformBank, transformLedger } from "../src/lib/import/transform";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label.padEnd(46)} ${ok ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const cents = (s: string) => {
  const m = parseMoneyCents(s);
  return m.ok ? applyMarker(m) : `rejected: ${m.reason}`;
};
const rejected = (v: unknown) => typeof v === "string" && v.startsWith("rejected");

console.log("\nmoney → integer cents");
check('"1,234.56"', cents("1,234.56"), 123456);
check('"$1,234.56"', cents("$1,234.56"), 123456);
check('"USD 1,234.56"', cents("USD 1,234.56"), 123456);
check('"(1,234.56)" accounting negative', cents("(1,234.56)"), -123456);
check('"-1,234.56"', cents("-1,234.56"), -123456);
check('"1,234.56-" trailing sign', cents("1,234.56-"), -123456);
check('"1.234,56" european', cents("1.234,56"), 123456);
check('"1.234.567,89" european grouped', cents("1.234.567,89"), 123456789);
check('"1,234" comma grouping', cents("1,234"), 123400);
check('"€ 9 999,99" nbsp grouped', cents("€ 9 999,99"), 999999);
check('"1.5" one decimal place', cents("1.5"), 150);
check('"0.07"', cents("0.07"), 7);
check('"100.00 DR" money out', cents("100.00 DR"), -10000);
check('"100.00 CR" money in', cents("100.00 CR"), 10000);
check('"1.234" three decimals is refused', rejected(cents("1.234")), true);
check('"12.345,678" three decimals is refused', rejected(cents("12.345,678")), true);
check('"n/a" is refused', rejected(cents("n/a")), true);
check('"" is refused', rejected(cents("")), true);
check('"1,2O4.00" letter O is refused', rejected(cents("1,2O4.00")), true);
// The regression this whole module exists to prevent.
check("parseFloat would have said 1.00", parseFloat("1,234.56") * 100, 100);

console.log("\ndates → YYYY-MM-DD");
const iso = (s: string, o: "mdy" | "dmy" = "mdy") => {
  const d = parseDateIso(s, o);
  return d.ok ? d.iso : `rejected: ${d.reason}`;
};
check('"2026-03-09"', iso("2026-03-09"), "2026-03-09");
check('"03/09/2026" as MDY', iso("03/09/2026", "mdy"), "2026-03-09");
check('"03/09/2026" as DMY', iso("03/09/2026", "dmy"), "2026-09-03");
check('"17/03/2026" resolves itself', iso("17/03/2026", "mdy"), "2026-03-17");
check('"09-Mar-2026"', iso("09-Mar-2026"), "2026-03-09");
check('"Mar 9, 2026"', iso("Mar 9, 2026"), "2026-03-09");
check('"20260309"', iso("20260309"), "2026-03-09");
check('"2026-03-09 00:00:00" time stripped', iso("2026-03-09 00:00:00"), "2026-03-09");
check('"3/9/26" two-digit year', iso("3/9/26"), "2026-03-09");
check('"02/30/2026" is refused', iso("02/30/2026").startsWith("rejected"), true);
check('"March" is refused', iso("March").startsWith("rejected"), true);
check("column with a >12 day resolves DMY", detectDateOrder(["17/03/2026", "01/02/2026"]).order, "dmy");
check("column with no evidence is ambiguous", detectDateOrder(["01/02/2026", "03/04/2026"]).ambiguous, true);

console.log("\nbundled samples, end to end");
const bankCsv = readFileSync(join(process.cwd(), "data/samples/bank_statement_sample.csv"), "utf8");
const glCsv = readFileSync(join(process.cwd(), "data/samples/general_ledger_sample.csv"), "utf8");

const bankParsed = parseCsv(bankCsv);
const bankMapping = guessMapping(bankParsed.headers, "bank");
check("bank: debit/credit pair detected", bankMapping.amountMode, "debit_credit");
check("bank: date column guessed", bankParsed.headers[bankMapping.columns.date!], "Posted Date");
check("bank: reference column guessed", bankParsed.headers[bankMapping.columns.reference!], "Reference");
check("bank: counterparty column guessed", bankParsed.headers[bankMapping.columns.counterparty!], "Payee");

const bank = transformBank(bankParsed, bankMapping);
check("bank: rows accepted", bank.rows.length, 21);
check("bank: rows rejected", bank.rejected.length, 2);
check("bank: rejects are the two summary lines", bank.rejected.map((r) => r.line), [2, 24]);
check("bank: date range", [bank.dateFrom, bank.dateTo], ["2026-03-02", "2026-03-31"]);
check("bank: period", bank.period, "2026-03");
check("bank: first row is money out", bank.rows[0].amount_cents, -124000);
check("bank: a deposit is money in", bank.rows.find((r) => r.external_ref === "INV-C204")!.amount_cents, 1890000);

const glParsed = parseCsv(glCsv);
const glMapping = guessMapping(glParsed.headers, "ledger");
check("ledger: single signed column", glMapping.amountMode, "signed");
check("ledger: account column guessed", glParsed.headers[glMapping.columns.account!], "Account Code");
check("ledger: doc ref column guessed", glParsed.headers[glMapping.columns.reference!], "Document No");
check("ledger: vendor column guessed", glParsed.headers[glMapping.columns.vendor!], "Vendor");

const gl = transformLedger(glParsed, glMapping);
check("ledger: rows accepted", gl.rows.length, 19);
check("ledger: nothing rejected", gl.rejected.length, 0);
check("ledger: parenthesised bill is negative", gl.rows[0].amount_cents, -124000);
check("ledger: quoted memo survives the comma", gl.rows[0].memo, "Freight forwarding, inbound March");
check("ledger: period", gl.period, "2026-03");

// The point of the exercise: the two sides agree to the cent on shared refs.
const shared = bank.rows.filter((b) => b.external_ref && gl.rows.some((g) => g.doc_ref === b.external_ref));
const agree = shared.filter((b) => gl.rows.some((g) => g.doc_ref === b.external_ref && g.amount_cents === b.amount_cents));
check("samples reconcile on shared references", [shared.length > 0, agree.length], [true, 15]);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
