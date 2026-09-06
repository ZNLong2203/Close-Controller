/**
 * Column guessing.
 *
 * Two exports never share a schema, so the mapping has to be editable — but a
 * screen of eleven empty dropdowns is a screen nobody fills in. The guess is
 * therefore a starting point that is right often enough to just click through,
 * and wrong in a way that is obvious on the preview.
 */
import { normalizeHeader } from "./csv";
import type { DateOrder } from "./dates";

export type ImportKind = "bank" | "ledger";
export type AmountMode = "signed" | "debit_credit";

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  hint: string;
  /** Most specific first: an earlier synonym outranks a later one on a tie. */
  synonyms: string[];
}

const DATE_SYNONYMS = [
  "transactiondate", "postingdate", "posteddate", "postdate", "valuedate", "bookingdate",
  "entrydate", "effectivedate", "gldate", "date", "posted", "transdate",
  "bookedon", "postedon", "dateposted",
];

export const BANK_FIELDS: FieldDef[] = [
  { key: "date", label: "Date", required: true, hint: "When the bank posted it", synonyms: DATE_SYNONYMS },
  {
    key: "amount", label: "Amount (signed)", required: true, hint: "Negative = money out",
    synonyms: ["transactionamount", "signedamount", "netamount", "amount", "value", "amt", "amountusd"],
  },
  {
    key: "debit", label: "Debit / money out", required: true, hint: "Withdrawals column",
    synonyms: ["debitamount", "withdrawal", "withdrawals", "moneyout", "paidout", "debit", "debits", "charge", "dr"],
  },
  {
    key: "credit", label: "Credit / money in", required: true, hint: "Deposits column",
    synonyms: ["creditamount", "deposit", "deposits", "moneyin", "paidin", "credit", "credits", "cr"],
  },
  {
    key: "description", label: "Description", required: true, hint: "Statement narrative",
    synonyms: ["transactiondescription", "description", "narrative", "narration", "particulars", "details", "memo", "transactiondetails", "text"],
  },
  {
    key: "reference", label: "Reference", required: false, hint: "Invoice or bank reference — the strongest matching signal",
    synonyms: ["paymentreference", "transactionreference", "referencenumber", "bankreference", "invoicenumber", "invoiceno", "externalref", "documentnumber", "documentno", "chequenumber", "checknumber", "reference", "ref", "docno", "transactionid"],
  },
  {
    key: "counterparty", label: "Counterparty", required: false, hint: "Who the money moved to or from",
    synonyms: ["counterparty", "beneficiary", "payee", "merchant", "payer", "vendorname", "vendor", "supplier", "customer", "party", "name"],
  },
  { key: "currency", label: "Currency", required: false, hint: "Defaults to USD", synonyms: ["currencycode", "currency", "ccy", "curr"] },
];

export const LEDGER_FIELDS: FieldDef[] = [
  { key: "date", label: "Date", required: true, hint: "When it was booked", synonyms: DATE_SYNONYMS },
  {
    key: "amount", label: "Amount (signed)", required: true, hint: "Negative = expense / money out",
    synonyms: ["transactionamount", "signedamount", "netamount", "amount", "value", "amt", "amountusd"],
  },
  {
    key: "debit", label: "Debit", required: true, hint: "Debit column",
    synonyms: ["debitamount", "debit", "debits", "dr"],
  },
  {
    key: "credit", label: "Credit", required: true, hint: "Credit column",
    synonyms: ["creditamount", "credit", "credits", "cr"],
  },
  {
    // Not hard-required: plenty of exports omit it, and refusing the whole file
    // over a label is worse than booking to a disclosed fallback account.
    key: "account", label: "Account code", required: false, hint: "GL account the line hits — falls back to 0000 if unmapped",
    synonyms: ["accountcode", "glaccount", "glcode", "nominalcode", "accountnumber", "accountno", "account", "accountname", "ledgeraccount"],
  },
  {
    key: "memo", label: "Memo", required: true, hint: "What the line is for",
    synonyms: ["journalmemo", "linedescription", "description", "memo", "narrative", "narration", "particulars", "details", "note", "notes"],
  },
  {
    key: "vendor", label: "Vendor", required: false, hint: "Party on the ledger side",
    synonyms: ["vendorname", "vendor", "supplier", "payee", "customer", "counterparty", "entity", "party", "name"],
  },
  {
    key: "reference", label: "Reference", required: false, hint: "Doc ref — matched against the bank reference",
    synonyms: ["documentnumber", "documentno", "documentref", "invoicenumber", "invoiceno", "referencenumber", "docref", "docno", "reference", "ref", "sourcedocument"],
  },
  { key: "currency", label: "Currency", required: false, hint: "Defaults to USD", synonyms: ["currencycode", "currency", "ccy", "curr"] },
];

export const fieldsFor = (kind: ImportKind): FieldDef[] => (kind === "bank" ? BANK_FIELDS : LEDGER_FIELDS);

/** Fields that only apply under one amount mode. */
export const isAmountField = (key: string) => key === "amount" || key === "debit" || key === "credit";
export const appliesUnder = (key: string, mode: AmountMode) =>
  !isAmountField(key) || (mode === "signed" ? key === "amount" : key !== "amount");

export interface ColumnMapping {
  /** field key -> column index into `headers`, or null for unmapped. */
  columns: Record<string, number | null>;
  amountMode: AmountMode;
  dateOrder: DateOrder;
}

function score(header: string, def: FieldDef): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  for (let i = 0; i < def.synonyms.length; i++) {
    const s = def.synonyms[i];
    if (h === s) return 1000 - i;
    if (h.startsWith(s) || h.endsWith(s)) return 600 - i;
    if (h.includes(s)) return 300 - i;
  }
  return 0;
}

/**
 * Greedy best-first assignment. Every (field, column) pair is scored, the whole
 * set sorted, and pairs taken while both sides are still free — so "Debit
 * Amount" cannot be stolen by the looser `amount` synonym before `debit` gets a
 * look at it.
 */
export function guessMapping(headers: string[], kind: ImportKind): ColumnMapping {
  const defs = fieldsFor(kind);
  const pairs: { field: string; col: number; s: number }[] = [];
  for (const def of defs) {
    for (let c = 0; c < headers.length; c++) {
      const s = score(headers[c], def);
      if (s > 0) pairs.push({ field: def.key, col: c, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s || a.col - b.col);

  const columns: Record<string, number | null> = {};
  for (const def of defs) columns[def.key] = null;
  const takenCols = new Set<number>();
  for (const p of pairs) {
    if (columns[p.field] !== null || takenCols.has(p.col)) continue;
    columns[p.field] = p.col;
    takenCols.add(p.col);
  }

  // A debit/credit pair and no signed column means the statement splits
  // direction across two columns. An explicit Amount column, where both exist,
  // is the more trustworthy of the two and wins.
  const hasPair = columns.debit !== null && columns.credit !== null;
  const amountMode: AmountMode = hasPair && columns.amount === null ? "debit_credit" : "signed";

  return { columns, amountMode, dateOrder: "auto" };
}

/** Required fields that are still unmapped under the chosen amount mode. */
export function missingRequired(mapping: ColumnMapping, kind: ImportKind): FieldDef[] {
  return fieldsFor(kind).filter(
    (f) => f.required && appliesUnder(f.key, mapping.amountMode) && mapping.columns[f.key] === null
  );
}
